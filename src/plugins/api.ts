// ===== PluginAPI：暴露给插件的 API =====
// 通过 BotClient 实现底层能力，插件无沙盒限制，可自由使用任何 Node.js 模块
import { BotClient } from '../protocol/bot';
import { Friend, Group, GroupMember, OldChatSdkHandle, ParsedMessage, PluginAPI as PluginAPIType, PluginConfig, UserProfile } from '../types';
import { logger } from '../logger';

export class PluginAPI implements PluginAPIType {
  private bot: BotClient;
  private pluginName: string;
  private messageHandlers: Array<(msg: ParsedMessage) => void> = [];
  private commandHandlers: Array<(cmd: string, args: string[], msg: ParsedMessage) => void> = [];
  /** 通过 on() 注册的事件监听器，dispose() 时统一移除，避免热重载重复订阅 */
  private registeredEvents: Array<[string, (...args: any[]) => void]> = [];
  config: PluginConfig = {};
  version = '3';

  /** 官方 OldChat API SDK 高级句柄：OC.* 业务方法 / apiFetch 裸传输层 / resolveMediaUrl */
  get sdk(): OldChatSdkHandle {
    return this.bot.api.sdk;
  }

  constructor(bot: BotClient, pluginName = '') {
    this.bot = bot;
    this.pluginName = pluginName;
  }

  /** 自己的 NCUID（API 用） */
  get myUid(): string {
    return this.bot.myUid;
  }

  /** 自己的旧 UID（显示用） */
  get myDisplayUid(): string {
    return this.bot.myDisplayUid;
  }

  /** 为某插件绑定实例（名称 + 插件自身配置） */
  bind(name: string, config: PluginConfig): void {
    this.pluginName = name;
    this.config = config || {};
  }

  /** 发送纯文本消息（自动适配 NCUID） */
  async send(targetId: string, text: string, type: 'direct' | 'group' = 'direct'): Promise<any> {
    return this.bot.sendMessage(targetId, text, type);
  }

  /** 发送媒体消息 */
  async sendMedia(
    targetId: string,
    mediaUrl: string,
    msgType: 'image' | 'voice' | 'video' | 'resource',
    thumbUrl?: string,
    type: 'direct' | 'group' = 'direct',
    opts?: { body?: string; durationMs?: number }
  ): Promise<any> {
    return this.bot.sendMedia(targetId, mediaUrl, msgType, thumbUrl, type, opts);
  }

  /** 上传文件（multipart/form-data，走框架鉴权与 401 自动刷新） */
  async upload<T = any>(path: string, formData: FormData): Promise<T> {
    return this.bot.api.upload<T>(path, formData);
  }

  /** 回复当前消息（自动判断类型） */
  async reply(msg: ParsedMessage, text: string): Promise<any> {
    return this.bot.replyToMessage(msg, text);
  }

  /** 声明已消费/处理该消息（未消费的消息会触发 message:unhandled 兜底事件） */
  consume(msg: ParsedMessage): void {
    this.bot.markConsumed(msg);
  }

  /** 获取用户资料（缓存 4 小时） */
  getUserProfile(uid: string): Promise<UserProfile | null> {
    return this.bot.getUserProfile(uid);
  }

  /** 获取好友列表（缓存） */
  getFriends(): Promise<Friend[]> {
    return this.bot.getFriends();
  }

  /** 获取群聊列表（缓存） */
  getGroups(): Promise<Group[]> {
    return this.bot.getGroups();
  }

  /** 获取群成员列表（缓存） */
  getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return this.bot.getGroupMembers(groupId);
  }

  /** 注册命令（如 ping → !ping） */
  registerCommand(name: string, handler: (args: string[], msg: ParsedMessage) => void): void {
    this.bot.registerCommand(name, handler);
  }

  /** 订阅消息回调（等价于插件导出 onMessage 钩子） */
  onMessage(handler: (msg: ParsedMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /** 订阅命令回调（等价于插件导出 onCommand 钩子） */
  onCommand(handler: (cmd: string, args: string[], msg: ParsedMessage) => void): void {
    this.commandHandlers.push(handler);
  }

  /** 供 PluginManager 分发消息时调用（触发插件内订阅的回调） */
  dispatchMessage(msg: ParsedMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (e: any) {
        this.log('error', `onMessage 回调异常: ${e.message}`);
      }
    }
  }

  /** 供 PluginManager 分发命令时调用（触发插件内订阅的回调） */
  dispatchCommand(cmd: string, args: string[], msg: ParsedMessage): void {
    for (const handler of this.commandHandlers) {
      try {
        handler(cmd, args, msg);
      } catch (e: any) {
        this.log('error', `onCommand 回调异常: ${e.message}`);
      }
    }
  }

  /** 监听框架事件（同 EventBus） */
  on(event: string, listener: (...args: any[]) => void): void {
    this.bot.events.on(event, listener);
    // 记录以便卸载/热重载时移除，防止重复触发
    this.registeredEvents.push([event, listener]);
  }

  /** 释放插件资源：移除所有通过 on() 注册的事件监听器（卸载/热重载时调用） */
  dispose(): void {
    for (const [event, listener] of this.registeredEvents) {
      this.bot.events.off(event, listener);
    }
    this.registeredEvents = [];
    this.messageHandlers = [];
    this.commandHandlers = [];
  }

  /** 输出日志（自动添加插件名前缀） */
  log(level: string, ...args: any[]): void {
    const message = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    const full = `[${this.pluginName}] ${message}`;
    if (level === 'debug') logger.debug(full);
    else if (level === 'warn') logger.warn(full);
    else if (level === 'error') logger.error(full);
    else logger.info(full);
  }
}
