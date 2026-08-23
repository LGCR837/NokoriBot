// OpenAI ChatLLM + TTS 插件（openaichatllmtts）
// 使用 OpenAI 兼容接口（/v1/chat/completions）进行 LLM 对话，
// 支持 TTS 语音合成（/v1/audio/speech），文本与语音同时发送。
// 上下文：按会话（群/私聊）保留最近 N 条消息。
import axios from 'axios';
import { PluginAPI, ParsedMessage } from '../../src/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 会话上下文：key = direct:<uid> 或 group:<gid> */
const contextMap = new Map<
  string,
  Array<{ role: 'system' | 'user' | 'assistant'; content: string; name?: string }>
>();

function uidEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * 调用 OpenAI 兼容 /v1/chat/completions，返回回复文本。
 */
async function askLLM(
  messages: Array<{ role: string; content: string }>,
  opts: { apiKey: string; baseUrl: string; model: string }
): Promise<string> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const resp = await axios.post(
    `${baseUrl}/v1/chat/completions`,
    { model: opts.model, messages },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      timeout: 60000,
    }
  );
  const data = resp.data;
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('LLM 返回空回复');
  return reply;
}

interface TTSOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  instruction: string;
  minAudioBytes: number;
  timeoutMs: number;
}

async function generateTTS(text: string, opts: TTSOpts): Promise<Buffer> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const payload: Record<string, string> = {
    model: opts.model,
    input: text,
    voice: opts.voice,
  };
  if (opts.instruction) payload.instruction = opts.instruction;

  const resp = await axios.post(`${baseUrl}/v1/audio/speech`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    responseType: 'arraybuffer',
    timeout: opts.timeoutMs,
  });
  const data = resp.data;
  if (!data || (typeof data.byteLength === 'number' && data.byteLength === 0)) {
    throw new Error('TTS 返回空音频');
  }
  const buf = Buffer.from(data);
  const contentType = String(resp.headers?.['content-type'] || '');
  if (contentType && !contentType.startsWith('audio/')) {
    throw new Error(`TTS 返回非音频数据（Content-Type: ${contentType}）`);
  }
  if (buf.length < opts.minAudioBytes) {
    throw new Error(`TTS 返回疑似错误数据（仅 ${buf.length} 字节 < ${opts.minAudioBytes}）`);
  }
  return buf;
}

function estimateDurationMs(buffer: Buffer, fallbackMs: number): number {
  if (!buffer || buffer.length < 1024) return fallbackMs;
  const seconds = buffer.length / (128000 / 8);
  return Math.max(1000, Math.round(seconds * 1000));
}

async function uploadAudio(api: PluginAPI, audio: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'reply.mp3');
  const upData: any = await api.upload('/v1/media', form);
  const url = upData?.url || upData?.media_url || upData?.data?.url;
  if (!url) throw new Error('音频上传失败');
  return url;
}

export function onLoad(api: PluginAPI) {
  const config = api.config || {};
  const apiKey: string = config.apiKey || '';
  const baseUrl: string = config.baseUrl || 'https://api.openai.com';
  const model: string = config.model || 'gpt-4o-mini';
  const systemPrompt: string = config.systemPrompt || '你是 NokoriBot 的智能聊天助手，请用中文友好地回答问题。';
  const maxHistory: number = Math.max(2, parseInt(config.maxHistory, 10) || 10);
  const replyOnError: boolean = config.replyOnError !== false;

  // TTS 配置
  const ttsEnabled: boolean = config.ttsEnabled !== false;
  const ttsOpts: TTSOpts = {
    baseUrl: config.ttsBaseUrl || 'https://api.openai.com',
    apiKey: config.ttsApiKey || '',
    model: config.ttsModel || 'tts-1',
    voice: config.ttsVoice || 'alloy',
    instruction: config.ttsInstruction || '',
    minAudioBytes: parseInt(config.ttsMinAudioBytes, 10) || 4000,
    timeoutMs: parseInt(config.ttsTimeoutMs, 10) || 120000,
  };
  const ttsMaxTextLength: number = parseInt(config.ttsMaxTextLength, 10) || 32;
  const voiceBody: string = config.voiceBody || '[语音]';
  const voiceDurationMs: number = parseInt(config.voiceDurationMs, 10) || 60000;

  // 违禁词
  const bannedWords: string[] = Array.isArray(config.bannedWords) ? config.bannedWords.map(String) : [];

  // 频率限制
  const rateLimitMaxPerMin: number = parseInt(config.rateLimitMaxPerMin, 10) || 6;
  const rateLimitTtsCooldownMs: number = parseInt(config.rateLimitTtsCooldownMs, 10) || 600000;
  const requestTimestamps = new Map<string, number[]>();
  const ttsDisabledUntil = new Map<string, number>();

  if (!apiKey) {
    api.log('warn', 'config.json 未配置 apiKey，LLM 调用不可用（插件仍加载）');
  }
  if (ttsEnabled && !ttsOpts.apiKey) {
    api.log('warn', 'config.json 未配置 ttsApiKey，TTS 不可用（将仅发送文本）');
  }

  api.on('message:unhandled', async (msg: ParsedMessage) => {
    if (msg.fromSelf) return;

    const myUid = api.myUid || '';
    const myDisplayUid = api.myDisplayUid || '';

    const mentionedSelf = (msg.mentions || []).some(
      (m) => uidEq(m.ncuid || '', myUid) || uidEq(m.uid || '', myDisplayUid)
    );
    const textHasSelf =
      (myUid && (msg.text || '').includes(`[ATNCUID:${myUid}]`)) ||
      (myDisplayUid && (msg.text || '').includes(`[ATUID:${myDisplayUid}]`));

    if (!mentionedSelf && !textHasSelf) {
      api.log('debug', '跳过 LLM');
      return;
    }

    const cleanTextRaw = (msg.text || '').replace(/\[AT(?:NCUID|UID):[^\]]+\]/g, '').trim();
    const lowerText = cleanTextRaw.toLowerCase();
    for (const w of bannedWords) {
      if (lowerText.includes(w.toLowerCase())) {
        api.log('debug', `[banned] 输入含违禁词「${w}」，丢弃`);
        return;
      }
    }

    const now = Date.now();
    const uid = msg.from;
    const timestamps = requestTimestamps.get(uid) || [];
    const recent = timestamps.filter((t) => now - t < 60000);
    recent.push(now);
    requestTimestamps.set(uid, recent);

    if (recent.length >= rateLimitMaxPerMin && !ttsDisabledUntil.has(uid)) {
      ttsDisabledUntil.set(uid, now + rateLimitTtsCooldownMs);
      api.log('info', `[rateLimit] ${uid} 1分钟内请求 ${recent.length} 次，禁用 TTS ${rateLimitTtsCooldownMs / 1000}s`);
    }

    const disabledUntil = ttsDisabledUntil.get(uid);
    if (disabledUntil && now >= disabledUntil) {
      ttsDisabledUntil.delete(uid);
      api.log('info', `[rateLimit] ${uid} TTS 禁用期已过，恢复正常`);
    }

    const ctxKey = msg.type === 'group' ? `group:${msg.groupId}` : `direct:${msg.from}`;
    let history = contextMap.get(ctxKey) || [];

    const cleanText = (msg.text || '').replace(/\[AT(?:NCUID|UID):[^\]]+\]/g, '').trim() || '(空消息)';

    api.log('info', `LLM 兜底处理（@了Bot）: ${cleanText.slice(0, 60)}`);

    if (!apiKey) {
      if (replyOnError) await api.reply(msg, '⚠️ LLM API Key 未配置（插件 config.json）');
      return;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const h of history) {
      if (h.role === 'user') {
        messages.push({ role: 'user', content: h.name ? `${h.name}: ${h.content}` : h.content });
      } else {
        messages.push({ role: 'assistant', content: h.content });
      }
    }
    const wakeHighlight = `【最新唤醒消息·请重点回应】${msg.fromName || msg.from}: ${cleanText}`;
    messages.push({ role: 'user', content: wakeHighlight });

    let replyText: string | null = null;
    let llmOk = false;
    try {
      const reply = await askLLM(messages, { apiKey, baseUrl, model });
      replyText = reply;
      llmOk = true;
      history.push({ role: 'user', content: cleanText, name: msg.fromName || msg.from });
      history.push({ role: 'assistant', content: reply });
      if (history.length > maxHistory) history = history.slice(-maxHistory);
      contextMap.set(ctxKey, history);
      api.log('debug', 'LLM 回复完成');
    } catch (e: any) {
      api.log('error', `LLM 调用失败: ${e.message}`);
      if (replyOnError) replyText = '猫猫晕乎乎的，没有什么想说的喵~';
    }

    if (replyText !== null) {
      try {
        const target = msg.type === 'group' && msg.groupId ? msg.groupId : msg.from;
        const type: 'direct' | 'group' = msg.type === 'group' ? 'group' : 'direct';
        const canTTS = ttsEnabled && ttsOpts.apiKey && llmOk && replyText.length <= ttsMaxTextLength
          && !ttsDisabledUntil.has(msg.from);

        if (!canTTS) {
          await api.reply(msg, replyText);
          return;
        }

        let audio: Buffer;
        let url: string;
        try {
          audio = await generateTTS(replyText, ttsOpts);
          url = await uploadAudio(api, audio);
        } catch (e: any) {
          api.log('error', `TTS 生成/上传失败，仅发送文本: ${e.message}`);
          await api.reply(msg, replyText);
          return;
        }

        const durationMs = estimateDurationMs(audio, voiceDurationMs);
        const results = await Promise.allSettled([
          api.reply(msg, replyText),
          api.sendMedia(target, url, 'voice', '', type, { body: voiceBody, durationMs }),
        ]);
        if (results[1].status === 'rejected') {
          api.log('error', `语音消息发送失败（文本已发送）: ${(results[1].reason as Error)?.message}`);
        }
        api.log('debug', 'LLM+TTS 回复完成（文本与语音已同时发送）');
      } catch (e: any) {
        api.log('error', `发送回复失败: ${e.message}`);
      }
    }
  });

  const clearContext = (msg: ParsedMessage): void => {
    const ctxKey = msg.type === 'group' ? `group:${msg.groupId}` : `direct:${msg.from}`;
    contextMap.delete(ctxKey);
    api.log('info', `[清空上下文] ${ctxKey}`);
    api.reply(msg, '上下文已经清空了喵~');
  };

  api.onMessage((msg: ParsedMessage) => {
    if (msg.fromSelf) return;
    const raw = (msg.text || '').replace(/^[/!]+/, '').trim();
    if (!raw) return;
    if (/^清空上下文$/i.test(raw)) {
      api.consume(msg);
      clearContext(msg);
    }
  });
  api.registerCommand('清空上下文', (_args, msg) => clearContext(msg));

  api.log('info', `OpenAI ChatLLM+TTS plugin loaded (model=${model}, tts=${ttsEnabled})`);
}

export function onUnload() {
  contextMap.clear();
  requestTimestamps.clear();
  ttsDisabledUntil.clear();
}
