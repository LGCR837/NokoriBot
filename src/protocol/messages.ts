// ===== MessageParser：消息解析器 =====
// 移植自 oldchat-kivotos-next/src/app.js 的 v2 解析逻辑
// v2 消息格式：{ v: 2, text: string, mentions?: [{ncuid, name}], quote?: {...} }
//
// AT 提及封装约定：
// - 接收方向：v2 消息中的 mentions 会以 [ATNCUID:xxx] / [ATUID:xxx] 形式出现在解析后的 text 中
//   （替换原文本中的 @名字），便于插件按 ID 识别被提及者
// - 发送方向：文本中的 [ATNCUID:xxx] / [ATUID:xxx] 会被提取为 v2 mentions 数组，
//   并在正文中还原为 @id 供前端高亮显示
import { Mention, ParsedMessage, Quote } from '../types';
import { getFromAvatar, getFromName, getFromUid, isSelfUid } from './ncuid';

/** 匹配 [ATUID:xxx] 或 [ATNCUID:xxx] 封装 token */
const AT_TOKEN_RE = /\[AT(?:NCUID|UID):([^\]]+)\]/g;

/** 正则转义（提及名字可能含特殊字符） */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class MessageParser {
  /** 自己的 UID（ncuid 优先）与显示 UID，用于 fromSelf 判断 */
  private myUid = '';
  private myDisplayUid = '';

  /** 由 BotClient 在登录后设置 */
  setSelf(myUid: string, myDisplayUid?: string): void {
    this.myUid = myUid || '';
    this.myDisplayUid = myDisplayUid || '';
  }

  /** 判断消息体是否为 v2 JSON 格式 */
  isV2(body: string): boolean {
    if (!body || typeof body !== 'string') return false;
    const trimmed = body.trim();
    if (!trimmed.startsWith('{')) return false;
    try {
      const obj = JSON.parse(trimmed);
      return obj && typeof obj === 'object' && obj.v === 2;
    } catch {
      return false;
    }
  }

  /** 解析 v2 消息体为结构对象 */
  parseV2(body: string): { text: string; mentions: Mention[]; quote: Quote | null } | null {
    try {
      const obj = JSON.parse(body);
      if (!obj || typeof obj !== 'object' || obj.v !== 2) return null;
      return {
        text: obj.text || '',
        mentions: Array.isArray(obj.mentions) ? obj.mentions : [],
        quote: obj.quote || null,
      };
    } catch {
      return null;
    }
  }

  // ===== AT 封装：接收方向 =====

  /**
   * 将 v2 mentions 转换为 [ATNCUID:xxx] / [ATUID:xxx] 文本。
   * 把正文中的 @名字（可能带零宽空格 \u200B）替换为封装 token。
   */
  mentionsToAtText(text: string, mentions: Mention[]): string {
    let result = text;
    for (const m of mentions || []) {
      const name = m.name || m.uid || m.ncuid;
      if (!name) continue;
      const token = m.ncuid ? `[ATNCUID:${m.ncuid}]` : m.uid ? `[ATUID:${m.uid}]` : null;
      if (!token) continue;
      const re = new RegExp(`@${escapeRegExp(name)}\u200B?`, 'g');
      result = result.replace(re, token);
    }
    return result;
  }

  /** 从消息体中提取纯文本（v2 解包并封装 AT，或原始文本） */
  extractText(body: string): string {
    if (this.isV2(body)) {
      const parsed = this.parseV2(body);
      if (!parsed) return body;
      const text = this.mentionsToAtText(parsed.text, parsed.mentions);
      return this.quoteToReplyText(text, parsed.quote);
    }
    return body;
  }

  /**
   * 将 v2 引用（quote）封装为 [REPLY:内容] token（接收方向，单向）。
   * 放在正文最前面，便于 LLM/插件识别被引用的消息内容。
   */
  quoteToReplyText(text: string, quote: Quote | null): string {
    if (!quote) return text;
    const quotedText = (quote.text || '').trim();
    if (!quotedText) return text;
    return `[REPLY:${quotedText}] ${text}`;
  }

  // ===== AT 封装：发送方向 =====

  /**
   * 从文本中提取 [ATNCUID:xxx] / [ATUID:xxx] token。
   * 返回净化后的文本（token 还原为 @id）与提取出的 mentions 数组。
   */
  extractAtTokens(text: string): { text: string; mentions: Mention[] } {
    const mentions: Mention[] = [];
    const clean = text.replace(AT_TOKEN_RE, (full, id: string) => {
      if (full.startsWith('[ATNCUID:')) {
        mentions.push({ ncuid: id, name: id });
      } else {
        mentions.push({ uid: id, name: id });
      }
      return '@' + id;
    });
    return { text: clean, mentions };
  }

  /**
   * 构建 v2 消息体 JSON 字符串。
   * 自动提取文本中的 [ATUID]/[ATNCUID] token 为 mentions；
   * 仅当包含换行 / @提及 / 引用时自动升级为 v2 格式。
   */
  buildV2(text: string, mentions?: Mention[], quote?: Quote): string {
    const { text: cleanText, mentions: extracted } = this.extractAtTokens(text);
    const allMentions = [...(mentions || []), ...extracted];
    const needV2 = cleanText.includes('\n') || allMentions.length > 0 || !!quote;
    if (!needV2) return cleanText;
    const obj: any = { v: 2, text: cleanText };
    if (allMentions.length > 0) obj.mentions = allMentions;
    if (quote) obj.quote = quote;
    return JSON.stringify(obj);
  }

  /**
   * 解析 WS 推送的原始消息对象为统一 ParsedMessage。
   * 支持 direct_message / group_message 两种消息数据。
   */
  parseMessage(msg: any): ParsedMessage | null {
    if (!msg || !msg.type) return null;
    if (msg.type === 'direct_message' || msg.type === 'group_message') {
      return this.parseData(msg.data || {}, msg.type === 'group_message' ? 'group' : 'direct');
    }
    return null;
  }

  /** 解析消息数据对象（消息列表 / WS 推送共用） */
  parseData(d: any, type: 'direct' | 'group'): ParsedMessage {
    const from = getFromUid(d) || '';
    const rawBody: string = d.body || '';
    const isV2 = this.isV2(rawBody);
    const v2 = isV2 ? this.parseV2(rawBody) : null;

    const msg: ParsedMessage = {
      id: d.id || '',
      from,
      fromName: getFromName(d) || from,
      fromAvatar: getFromAvatar(d) || '',
      fromSelf: isSelfUid(from, this.myUid, this.myDisplayUid),
      // v2 消息的 text 中：@名字 → [ATNCUID:xxx]/[ATUID:xxx]，引用 → [REPLY:内容]
      text: v2 ? this.quoteToReplyText(this.mentionsToAtText(v2.text, v2.mentions), v2.quote) : rawBody,
      rawBody,
      msgType: d.msg_type || 'text',
      mediaUrl: d.media_url || null,
      thumbUrl: d.thumb_url || null,
      type,
      target: type === 'group' ? d.group_id || '' : from,
      createdAt: d.created_at || Math.floor(Date.now() / 1000),
      mentions: v2 ? v2.mentions : [],
      quote: v2 ? v2.quote : null,
      ephemeral: !!d.ephemeral,
    };
    if (type === 'group') msg.groupId = d.group_id || '';
    return msg;
  }
}
