// AI 生图插件（imagecreate）
// 调用 Agnes Image 2.1 Flash API 生成图片
// 触发方式：生图 xxxx / 绘画 xxxx（不区分大小写）
import axios from 'axios';
import { PluginAPI, ParsedMessage } from '../../src/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 调用 Agnes AI 图片生成 API，返回图片 URL */
async function generateImage(
  prompt: string,
  opts: { apiKey: string; model: string; size: string; ratio: string; timeoutMs: number }
): Promise<string> {
  const resp = await axios.post(
    'https://api.agnes-ai.cn/v1/images/generations',
    {
      model: opts.model,
      prompt,
      size: opts.size,
      ratio: opts.ratio,
      extra_body: { response_format: 'url' },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      timeout: opts.timeoutMs,
    }
  );
  const url = resp.data?.data?.[0]?.url;
  if (!url) throw new Error('API 未返回图片 URL');
  return url;
}

export function onLoad(api: PluginAPI) {
  const config = api.config || {};
  const apiKey: string = config.apiKey || '';
  const model: string = config.model || 'agnes-image-2.1-flash';
  const size: string = config.size || '2K';
  const ratio: string = config.ratio || '1:1';
  const timeoutMs: number = parseInt(config.timeoutMs, 10) || 120000;

  if (!apiKey) {
    api.log('warn', 'config.json 未配置 apiKey，AI 生图不可用');
  }

  api.onMessage(async (msg: ParsedMessage) => {
    if (msg.fromSelf) return;
    const text = (msg.text || '').trim();

    // 匹配 生图 xxxx 或 绘画 xxxx
    const match = text.match(/^(?:生图|绘画)\s+(.+)$/i);
    if (!match) return;

    api.consume(msg);

    if (!apiKey) {
      await api.reply(msg, '⚠️ AI 生图 API Key 未配置（插件 config.json）');
      return;
    }

    const prompt = match[1].trim();
    if (!prompt) {
      await api.reply(msg, '请在「生图」或「绘画」后面输入提示词');
      return;
    }

    api.log('info', `生图请求: ${prompt.slice(0, 60)}`);

    try {
      const url = await generateImage(prompt, { apiKey, model, size, ratio, timeoutMs });

      // 发送图片
      const target = msg.type === 'group' && msg.groupId ? msg.groupId : msg.from;
      const type: 'direct' | 'group' = msg.type === 'group' ? 'group' : 'direct';
      await api.sendMedia(target, url, 'image', '', type);
      api.log('info', `生图完成: ${prompt.slice(0, 40)}`);
    } catch (e: any) {
      api.log('error', `生图失败: ${e.message}`);
      await api.reply(msg, `生图失败: ${e.message}`);
    }
  });

  api.log('info', `Agnes Image plugin loaded (生图/绘画, model=${model})`);
}
