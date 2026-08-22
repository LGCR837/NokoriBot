// ===== BotClient：核心客户端 =====
// 协调 ApiClient / WsClient / MessageParser / PluginManager / EventBus / ConfigManager
// 负责：登录（token/密码）、WS 消息分发、消息发送、命令路由、插件生命周期
import { EventBus } from '../events';
import { ConfigManager } from '../config';
import { logger } from '../logger';
import { ApiClient } from './api';
import { WsClient } from './ws';
import { MessageParser, escapeRegExp } from './messages';
import { PluginManager } from '../plugins/manager';
import { PluginAPI } from '../plugins/api';
import { Friend, Group, GroupMember, ParsedMessage, UserInfo, UserProfile } from '../types';
import { getDisplayUid, getUid, profileQuery, toUidParam, withUidParam } from './ncuid';
import path from 'path';

export interface BotClientOptions {
  config: ConfigManager;
  events: EventBus;
  pluginsDir: string;
  /** 供 WebUI 获取 Bot 状态回调 */
  onStatusChange?: (online: boolean) => void;
}

// 用户资料缓存（4 小时过期）
const CACHE_TTL = 4 * 60 * 60 * 1000;

export class BotClient {
  api: ApiClient;
  ws: WsClient;
  parser: MessageParser;
  events: EventBus;
  plugins: PluginManager;

  private config: ConfigManager;
  private myUidValue = '';
  private myDisplayUidValue = '';
  private myNameValue = '';
  private myAvatar = '';
  private startTime = 0;
  private stopped = false;
  private userProfileCache = new Map<string, UserProfile & { _ts: number }>();
  private friendsCache: Friend[] = [];
  private groupsCache: Group[] = [];
  private friendsCacheTs = 0;
  private groupsCacheTs = 0;
  private groupMembersCache = new Map<string, { ts: number; members: GroupMember[] }>();
  private commands = new Map<string, (args: string[], msg: ParsedMessage) => void>();
  /** 已被插件消费的消息（WeakSet，避免内存泄漏） */
  private consumedMsgs = new WeakSet<ParsedMessage>();

  constructor(opts: BotClientOptions) {
    this.config = opts.config;
    this.events = opts.events;
    this.parser = new MessageParser();
    this.api = new ApiClient({
      backendOrigin: () => this.config.get('backendOrigin'),
      mediaOrigin: () => this.config.get('mediaOrigin'),
      getUser: () => this.config.get<UserInfo | null>('user') || null,
      getDeviceId: () => this.config.get('deviceId') || '',
      getAccessToken: () => this.config.get('accessToken') || '',
      getRefreshToken: () => this.config.get('refreshToken') || '',
      onTokensUpdated: (accessToken, refreshToken, user) => {
        this.config.update({
          accessToken,
          refreshToken,
          user: user || this.config.get('user'),
        } as any);
        if (user) this.applyUserInfo(user);
      },
      relogin: async () => {
        const username = this.config.get<string>('username');
        const password = this.config.get<string>('password');
        if (!username || !password) throw new Error('配置中缺少账号密码，无法重新登录');
        const user = await this.api.login(username, password);
        this.applyUserInfo(user);
      },
    });

    this.ws = new WsClient({
      backendOrigin: this.config.get('backendOrigin'),
      getAccessToken: () => this.config.get('accessToken') || '',
      onAuthFailed: async () => {
        const username = this.config.get<string>('username');
        const password = this.config.get<string>('password');
        if (!username || !password) throw new Error('配置中缺少账号密码，无法重新登录');
        const user = await this.api.login(username, password);
        this.applyUserInfo(user);
      },
      handshake: async (clientPub: string) => {
        // 必须携带 client_pub（ECDH 客户端公钥），否则服务端返回 400
        const data = await this.api.post<{ server_pub: string; session_id: string }>('/auth/handshake', {
          client_pub: clientPub,
        });
        return data;
      },
    });

    // 构建插件 API（每个插件独立实例，延迟绑定插件名）
    this.plugins = new PluginManager(opts.pluginsDir, () => new PluginAPI(this), this);

    this.setupWsEvents();
    this.setupConfigWatcher();
  }

  get myUid(): string {
    return this.myUidValue;
  }

  get myDisplayUid(): string {
    return this.myDisplayUidValue;
  }

  get myName(): string {
    return this.myNameValue;
  }

  /** 启动 Bot：登录 + 连接 WS + 加载插件 */
  async start(): Promise<void> {
    this.startTime = Date.now();
    this.stopped = false;
    try {
      // 已有持久化 token 则直接使用，否则用账号密码登录
      if (!this.config.get<string>('accessToken')) {
        const username = this.config.get<string>('username');
        const password = this.config.get<string>('password');
        if (username && password) {
          logger.info('[Bot] 正在登录...');
          // login() 内部会通过 onTokensUpdated 回调调用 applyUserInfo，此处无需重复设置
          await this.api.login(username, password);
        } else {
          logger.warn('[Bot] 未配置账号密码，跳过登录（请在 WebUI 配置后重试）');
          return;
        }
      } else {
        // 使用持久化 token，若失效则 api 内部自动刷新/重登
        const storedUser = this.config.get<UserInfo>('user');
        if (storedUser) this.applyUserInfo(storedUser);
        logger.info('[Bot] 使用持久化 token 启动');
        // 服务端 ?uid= 同时接受 uid/ncuid（参考 63cede3 修复）
        await this.api.get('/users/profile?uid=' + encodeURIComponent(this.myUidValue)).catch(() => {});
      }

      await this.plugins.loadAll();
      await this.connectWs();
      this.emitStatus(true);
      logger.info(`[Bot] 启动完成，登录用户: ${this.myName} (${this.myUidValue || this.myDisplayUidValue})`);
    } catch (e: any) {
      logger.error(`[Bot] 启动失败: ${e.message}`);
      this.emitStatus(false);
      throw e;
    }
  }

  /** 停止 Bot */
  async stop(): Promise<void> {
    this.stopped = true;
    this.ws.close();
    await this.plugins.unloadAll();
    this.emitStatus(false);
    logger.info('[Bot] 已停止');
  }

  /** 重新启动（WebUI 重启按钮） */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** 连接 WebSocket */
  private async connectWs(): Promise<void> {
    this.ws.invalidateSession();
    await this.ws.connect();
  }

  /**
   * 构建发送用 v2 消息体：解析文本中的 [ATNCUID:xxx]/[ATUID:xxx] token 为 mentions，
   * 并查询用户昵称，把正文中的 @id 还原为 @昵称（而非 @ncuid）。
   * 查询失败时回退为 @id 原样显示。
   */
  private async buildV2Text(text: string): Promise<string> {
    const { text: cleanText, mentions } = this.parser.extractAtTokens(text);
    if (mentions.length === 0) {
      return this.parser.buildV2(cleanText);
    }
    // 逐条查询被提及用户的昵称（getUserProfile 自带 4 小时缓存）
    const resolvedMentions: { ncuid?: string; uid?: string; name: string }[] = [];
    let displayText = cleanText;
    for (const m of mentions) {
      const uid = m.ncuid || m.uid || '';
      let name = m.name || uid;
      if (uid) {
        const profile = await this.getUserProfile(uid);
        if (profile) {
          name = profile.display_name || profile.username || name;
        }
      }
      resolvedMentions.push({ ...m, name });
      // 把正文中 token 还原出的 @id 替换为 @昵称
      const id = m.ncuid || m.uid || '';
      if (id && name) {
        displayText = displayText.replace(new RegExp(`@${escapeRegExp(id)}`, 'g'), `@${name}`);
      }
    }
    return this.parser.buildV2(displayText, resolvedMentions);
  }

  /** 发送文本消息 */
  async sendMessage(targetId: string, text: string, type: 'direct' | 'group' = 'direct'): Promise<any> {
    const body = await this.buildV2Text(text);
    const payload =
      type === 'group'
        ? { group_id: targetId, body, msg_type: 'text', media_url: '', thumb_url: '' }
        : { body, msg_type: 'text', media_url: '', thumb_url: '', ...toUidParam(targetId) };
    const endpoint = type === 'group' ? '/groups/message/send' : '/direct/send';
    const data = await this.api.post(endpoint, payload);
    logger.debug(`[Bot] 已发送消息到 ${targetId}: ${text.slice(0, 50)}`);
    return data;
  }

  /** 发送媒体消息 */
  async sendMedia(
    targetId: string,
    mediaUrl: string,
    msgType: 'image' | 'voice' | 'video' | 'resource' | string,
    thumbUrl?: string,
    type: 'direct' | 'group' = 'direct',
    opts?: { body?: string; durationMs?: number }
  ): Promise<any> {
    const body = opts?.body !== undefined ? opts.body : '';
    const payload: Record<string, any> = {
      body,
      msg_type: msgType,
      media_url: mediaUrl,
      thumb_url: thumbUrl || '',
    };
    // 语音消息：服务器要求带 duration_ms（对照文档媒体发送 payload），
    // 无论调用方是否显式传 durationMs 都必须写入 payload.duration_ms
    if (msgType === 'voice') {
      payload.duration_ms = opts?.durationMs !== undefined ? opts.durationMs : 60000;
    }
    if (type === 'group') {
      payload.group_id = targetId;
    } else {
      Object.assign(payload, toUidParam(targetId));
    }
    const endpoint = type === 'group' ? '/groups/message/send' : '/direct/send';
    const data = await this.api.post(endpoint, payload);
    logger.debug(`[Bot] 已发送媒体消息(${msgType})到 ${targetId}`);
    return data;
  }

  /** 回复消息（自动判断类型） */
  async replyToMessage(msg: ParsedMessage, text: string): Promise<any> {
    if (msg.type === 'group' && msg.groupId) {
      return this.sendMessage(msg.groupId, text, 'group');
    }
    return this.sendMessage(msg.from, text, 'direct');
  }

  /** 获取用户资料（缓存 4 小时） */
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    if (!uid) return null;
    const key = uid.toUpperCase();
    const cached = this.userProfileCache.get(key);
    if (cached && Date.now() - cached._ts < CACHE_TTL) return cached;
    // NCUID 不一定以 nc_ 开头（USR-xxx 也是 ncuid），但 nc_ 前缀确定是 NCUID：
    //   - nc_ 前缀：直接 ?ncuid=（一次命中，无需回退）
    //   - 非 nc_：优先 ?ncuid=，失败回退 ?uid=（可能传入的是纯 uid）
    const ncuidQuery = '/v1/users/profile?ncuid=' + encodeURIComponent(uid);
    const queries: string[] = uid.startsWith('nc_')
      ? [ncuidQuery]
      : [ncuidQuery, profileQuery(uid)];
    for (const query of queries) {
      try {
        const data = await this.api.get<UserProfile>(query);
        (data as any)._ts = Date.now();
        this.userProfileCache.set(key, data as any);
        return data;
      } catch (e: any) {
        logger.warn(`[Bot] 获取用户资料失败 ${uid} (${query}): ${e.message}`);
      }
    }
    return null;
  }

  /** 获取好友列表（缓存 5 分钟） */
  async getFriends(force = false): Promise<Friend[]> {
    if (!force && this.friendsCache.length > 0 && Date.now() - this.friendsCacheTs < 5 * 60 * 1000) {
      return this.friendsCache;
    }
    try {
      const data = await this.api.get<{ friends: any[] }>('/friends');
      this.friendsCache = (data.friends || []).map((f) => ({
        uid: getUid(f),
        displayUid: getDisplayUid(f),
        name: f.display_name || f.username || getUid(f),
        username: f.username,
        display_name: f.display_name,
        avatar: f.avatar_url || '',
        remark_name: f.remark_name || '',
      }));
      this.friendsCacheTs = Date.now();
    } catch (e: any) {
      logger.warn(`[Bot] 获取好友列表失败: ${e.message}`);
    }
    return this.friendsCache;
  }

  /** 获取群聊列表（缓存 5 分钟） */
  async getGroups(force = false): Promise<Group[]> {
    if (!force && this.groupsCache.length > 0 && Date.now() - this.groupsCacheTs < 5 * 60 * 1000) {
      return this.groupsCache;
    }
    try {
      const data = await this.api.get<{ groups: any[] }>('/groups/list');
      this.groupsCache = (data.groups || []).map((g) => ({
        id: g.group_id,
        name: g.name,
        avatar: g.avatar_url || '',
        member_count: g.member_count,
        role: g.role,
      }));
      this.groupsCacheTs = Date.now();
    } catch (e: any) {
      logger.warn(`[Bot] 获取群聊列表失败: ${e.message}`);
    }
    return this.groupsCache;
  }

  /** 获取群成员列表（缓存 5 分钟） */
  async getGroupMembers(groupId: string, force = false): Promise<GroupMember[]> {
    const key = 'group:' + groupId;
    const cached = this.groupMembersCache.get(key);
    if (!force && cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.members;
    try {
      const data = await this.api.get<{ members?: any[] } | any[]>(
        '/groups/members?group_id=' + encodeURIComponent(groupId)
      );
      const list: any[] = Array.isArray(data) ? data : (data && data.members) || [];
      const members: GroupMember[] = list.map((m: any) => ({
        uid: getUid(m),
        displayUid: getDisplayUid(m),
        name: m.display_name || m.username || getUid(m) || '',
        username: m.username,
        display_name: m.display_name,
        avatar: m.avatar_url || '',
        role: m.role,
      }));
      this.groupMembersCache.set(key, { ts: Date.now(), members });
      return members;
    } catch (e: any) {
      logger.warn(`[Bot] 获取群成员列表失败 ${groupId}: ${e.message}`);
      return cached ? cached.members : [];
    }
  }

  /** 标记已读 */
  async markRead(targetId: string, type: 'direct' | 'group'): Promise<void> {
    try {
      if (type === 'group') {
        await this.api.post('/groups/read', { group_id: targetId });
      } else {
        await this.api.post('/direct/read', withUidParam(targetId));
      }
    } catch {}
  }

  /** 注册命令（供 PluginAPI 调用） */
  registerCommand(name: string, handler: (args: string[], msg: ParsedMessage) => void): void {
    this.commands.set(name.toLowerCase(), handler);
  }

  /** 标记消息已被插件消费（供 PluginAPI.consume 调用） */
  markConsumed(msg: ParsedMessage): void {
    this.consumedMsgs.add(msg);
  }

  /** 消息是否已被某插件消费 */
  isConsumed(msg: ParsedMessage): boolean {
    return this.consumedMsgs.has(msg);
  }

  /** 获取 Bot 状态 */
  getStatus() {
    return {
      online: this.ws.connected,
      username: this.myName,
      uid: this.myUidValue || this.myDisplayUidValue,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
    };
  }

  // ===== 内部实现 =====

  /** 应用登录用户信息 */
  private applyUserInfo(user: UserInfo): void {
    this.myUidValue = user.ncuid || user.uid || '';
    this.myDisplayUidValue = user.uid || user.ncuid || '';
    this.myNameValue = user.display_name || user.username || '';
    this.myAvatar = user.avatar_url || '';
    this.parser.setSelf(this.myUidValue, this.myDisplayUidValue);
    logger.info(`[Bot] 当前用户: ${this.myName} (ncuid=${this.myUidValue || '-'}, uid=${this.myDisplayUidValue || '-'})`);
  }

  /** 监听 WS 事件 */
  private setupWsEvents(): void {
    this.ws.on('open', () => {
      this.emitStatus(true);
      this.events.emit('connected');
    });
    this.ws.on('close', () => {
      this.emitStatus(false);
      this.events.emit('disconnected');
    });
    this.ws.on('message', (msg: any) => {
      this.handleWsMessage(msg);
    });
    this.ws.on('error', (err: Error) => {
      this.events.emit('ws_error', err);
    });
  }

  /** 处理 WS 推送消息 */
  private handleWsMessage(msg: any): void {
    if (!msg || !msg.type) return;
    // 召回类消息（他人撤回等）也分发事件
    if (msg.type === 'direct_recall' || msg.type === 'group_recall') {
      this.events.emit('recall', msg);
      return;
    }
    const parsed = this.parser.parseMessage(msg);
    if (!parsed) return;

    // 调试日志：所有收到的消息（含自己的，便于排查"没反应"问题）
    logger.debug(
      `[Bot] 收到消息 [${parsed.type}] from=${parsed.from} (${parsed.fromName}) self=${parsed.fromSelf}: ${(parsed.text || '').slice(0, 60)}`
    );

    this.events.emit('message', parsed);
    this.events.emit(`message:${parsed.type}`, parsed);

    // 不处理自己的消息
    if (parsed.fromSelf) return;
    this.events.emit('message:incoming', parsed);

    // 交给插件
    this.plugins.dispatchMessage(parsed);

    // 命令路由：消息以 ! 开头
    const text = parsed.text.trim();
    if (text.startsWith('!')) {
      const spaceIdx = text.indexOf(' ');
      const cmd = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1).split(/\s+/) : [];
      this.events.emit('command', cmd, args, parsed);
      this.plugins.dispatchCommand(cmd, args, parsed);
      const handler = this.commands.get(cmd.toLowerCase());
      if (handler) {
        try {
          handler(args, parsed);
        } catch (e: any) {
          logger.error(`[Bot] 命令 ${cmd} 执行异常: ${e.message}`);
        }
      }
    }

    // 兜底：所有插件都未消费该消息时，触发 message:unhandled 事件
    // （供 ChatLLM 等兜底插件订阅，作为 LLM 入口）
    if (!this.isConsumed(parsed)) {
      logger.debug(`[Bot] 消息未被任何插件处理，触发 message:unhandled: ${(parsed.text || '').slice(0, 40)}`);
      this.events.emit('message:unhandled', parsed);
    }
  }

  /** 监听配置变更：凭证/后端地址变化时自动重连 */
  private setupConfigWatcher(): void {
    this.config.onUpdate((_cfg, changedKeys) => {
      const needRelogin =
        changedKeys.includes('backendOrigin') ||
        changedKeys.includes('username') ||
        changedKeys.includes('password');
      if (needRelogin && !this.stopped) {
        logger.info('[Bot] 配置变更，重新登录并重连...');
        this.restart().catch((e) => logger.error(`[Bot] 配置变更重启失败: ${e.message}`));
      }
    });
  }

  private emitStatus(online: boolean): void {
    this.events.emit('status', online);
  }
}
