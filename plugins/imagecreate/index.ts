// AI 生图插件（imagecreate）
// 调用 Agnes Image 2.0 Flash API 生成图片
// 触发方式：生图 xxxx / 绘画 xxxx（不区分大小写）
import axios from 'axios';
import { PluginAPI, ParsedMessage } from '../../src/types';

/** 调用 Agnes AI 图片生成 API，返回图片 URL */
async function generateImage(
  prompt: string,
  opts: { apiKey: string; model: string; size: string; timeoutMs: number }
): Promise<string> {
  const resp = await axios.post(
    'https://api.agnes-ai.cn/v1/images/generations',
    {
      model: opts.model,
      prompt,
      size: opts.size,
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

/** 下载图片并上传到 OC 服务器，返回 OC 媒体 URL */
async function downloadAndUpload(url: string, api: PluginAPI): Promise<string> {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  const buf = Buffer.from(resp.data);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), 'image.png');
  const upData: any = await api.upload('/v1/media', form);
  const mediaUrl = upData?.url || upData?.media_url || upData?.data?.url;
  if (!mediaUrl) throw new Error('图片上传到 OC 服务器失败');
  return mediaUrl;
}

export function onLoad(api: PluginAPI) {
  const config = api.config || {};
  const apiKey: string = config.apiKey || '';
  const model: string = config.model || 'agnes-image-2.0-flash';
  const size: string = config.size || '1024x1024';
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

    // 先发送提示消息
    await api.reply(msg, `正在生成【${prompt}】哦，请稍等一下喵~`);
    api.log('info', `生图请求: ${prompt.slice(0, 60)}`);

    try {
      const remoteUrl = await generateImage(prompt, { apiKey, model, size, timeoutMs });

      // 下载图片并重新上传到 OC 服务器
      const mediaUrl = await downloadAndUpload(remoteUrl, api);

      // 发送图片
      const target = msg.type === 'group' && msg.groupId ? msg.groupId : msg.from;
      const type: 'direct' | 'group' = msg.type === 'group' ? 'group' : 'direct';
      await api.sendMedia(target, mediaUrl, 'image', '', type);
      api.log('info', `生图完成: ${prompt.slice(0, 40)}`);
    } catch (e: any) {
      api.log('error', `生图失败: ${e.message}`);
      await api.reply(msg, `生图失败: ${e.message}`);
    }
  });

  api.log('info', `Agnes Image plugin loaded (生图/绘画, model=${model})`);
}
