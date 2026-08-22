// ===== NokoriBot 共享类型定义 =====

/** 官方 OldChat API SDK 句柄（暴露给插件的高级接口） */
export interface OldChatSdkHandle {
  /** 业务方法命名空间：OC.getMe / OC.getDirectMessages / OC.postMoment / OC.sendRedpacket 等 60+ 方法 */
  OC: Record<string, any>;
  /** SDK 业务错误类：`e instanceof sdk.OCError` 判断（携带 code 与 raw 原始错误对象） */
  OCError: any;
  /**
   * 传输层：请求任意 /v1、/v2 路径（自动附加令牌、ECDH 签名与信封加密、v1↔v2 回退、候选后端降级），
   * 返回原始 Response（自行 res.json()/res.text()）。url 需以 /v1 或 /v2 开头
   */
  apiFetch(url: string, init?: any): Promise<any>;
  /** 媒体地址解析：把相对路径解析为可加载的绝对 URL（头像/封面渲染用） */
  resolveMediaUrl(url: string): string;
}

/** Bot 配置（对应 config.json） */
export interface BotConfig {
  /** 后端 API 地址（不含 /v1 后缀） */
  backendOrigin: string;
  /** 媒体资源地址 */
  mediaOrigin: string;
  /** 登录用户名（identifier） */
  username: string;
  /** 登录密码 */
  password: string;
  /** 设备 ID（X-Device-Id 灰度绑定；首次启动自动生成并持久化） */
  deviceId: string;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** WebUI 端口 */
  webuiPort: number;
  /** WebUI 监听地址（KataBump/容器公网部署时设为 0.0.0.0） */
  webuiHost: string;
  /** 已持久化的访问令牌 */
  accessToken: string;
  /** 已持久化的刷新令牌 */
  refreshToken: string;
  /** 登录用户信息 */
  user: UserInfo | null;
}

/** 登录接口返回的用户信息 */
export interface UserInfo {
  ncuid?: string;
  uid?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  [key: string]: any;
}

/** @提及（v2 消息格式）：ncuid 与 uid 至少其一 */
export interface Mention {
  ncuid?: string;
  uid?: string;
  name: string;
}

/** 引用消息（v2 消息格式） */
export interface Quote {
  message_id: string;
  from_uid?: string;
  from_ncuid?: string;
  text?: string;
  [key: string]: any;
}

/** 解析后的消息 */
export interface ParsedMessage {
  /** 消息 ID */
  id: string;
  /** 发送者 ID（ncuid 优先，兼容旧 uid） */
  from: string;
  /** 发送者昵称 */
  fromName: string;
  /** 发送者头像 */
  fromAvatar: string;
  /** 是否为本人发送 */
  fromSelf: boolean;
  /** 消息正文（v2 已解包，纯文本） */
  text: string;
  /** 原始 body（可能是 v2 JSON 或纯文本） */
  rawBody: string;
  /** 消息类型：text / image / voice / video / resource */
  msgType: string;
  /** 媒体地址（媒体消息） */
  mediaUrl: string | null;
  /** 缩略图地址 */
  thumbUrl: string | null;
  /** 会话类型 */
  type: 'direct' | 'group';
  /** 群聊 ID（群消息） */
  groupId?: string;
  /** 目标对象（私聊对方 ID / 群 ID） */
  target: string;
  /** 创建时间（秒级时间戳） */
  createdAt: number;
  /** @提及列表（v2） */
  mentions: Mention[];
  /** 引用消息（v2） */
  quote: Quote | null;
  /** 阅后即焚 */
  ephemeral?: boolean;
}

/** 用户资料（/v1/users/profile 返回） */
export interface UserProfile {
  ncuid?: string;
  uid?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  [key: string]: any;
}

/** 好友 */
export interface Friend {
  uid: string;
  displayUid: string;
  name: string;
  username?: string;
  display_name?: string;
  avatar: string;
  remark_name?: string;
}

/** 群聊 */
export interface Group {
  id: string;
  name: string;
  avatar: string;
  member_count?: number;
  role?: string;
}

/** 群成员 */
export interface GroupMember {
  uid: string;
  displayUid: string;
  name: string;
  username?: string;
  display_name?: string;
  avatar?: string;
  role?: string;
}

/** 插件信息 */
export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  hasConfig: boolean;
  main: string;
  loaded: boolean;
  dir: string;
  error?: string;
}

/** 插件自身配置（插件目录 config.json） */
export interface PluginConfig {
  [key: string]: any;
}

/** 插件 API 能力接口 */
export interface PluginAPI {
  /** 发送纯文本消息（自动适配 NCUID） */
  send(targetId: string, text: string, type?: 'direct' | 'group'): Promise<any>;
  /** 发送媒体消息 */
  sendMedia(
    targetId: string,
    mediaUrl: string,
    msgType: 'image' | 'voice' | 'video' | 'resource',
    thumbUrl?: string,
    type?: 'direct' | 'group'
  ): Promise<any>;
  /** 回复当前消息（自动判断类型） */
  reply(msg: ParsedMessage, text: string): Promise<any>;
  /** 声明已消费/处理该消息（未消费的消息会触发 message:unhandled 兜底事件） */
  consume(msg: ParsedMessage): void;
  /** 获取用户资料（缓存 4 小时） */
  getUserProfile(uid: string): Promise<UserProfile | null>;
  /** 获取好友列表（缓存） */
  getFriends(): Promise<Friend[]>;
  /** 获取群聊列表（缓存） */
  getGroups(): Promise<Group[]>;
  /** 注册命令（如 ping） */
  registerCommand(name: string, handler: (args: string[], msg: ParsedMessage) => void): void;
  /** 订阅消息回调（等价于插件导出 onMessage 钩子） */
  onMessage(handler: (msg: ParsedMessage) => void): void;
  /** 订阅命令回调（等价于插件导出 onCommand 钩子） */
  onCommand(handler: (cmd: string, args: string[], msg: ParsedMessage) => void): void;
  /** 监听框架事件（同 EventBus） */
  on(event: string, listener: (...args: any[]) => void): void;
  /** 输出日志（自动添加插件名前缀） */
  log(level: string, ...args: any[]): void;
  /** 插件自身配置（从 config.json 读取） */
  config: PluginConfig;
  /** 框架版本号 */
  version: string;
  /** 官方 OldChat API SDK 高级句柄（OC.* 业务方法、apiFetch 裸传输层、resolveMediaUrl） */
  readonly sdk: OldChatSdkHandle;
  /** 自己的 ID（优先 ncuid，API 用；注意 ncuid 不一定以 nc_ 开头） */
  readonly myUid: string;
  /** 自己的旧 UID（显示用） */
  readonly myDisplayUid: string;
}

/** 插件入口模块（导出生命周期钩子） */
export interface PluginModule {
  onLoad?: (api: PluginAPI) => void;
  onMessage?: (msg: ParsedMessage, api: PluginAPI) => void;
  onCommand?: (cmd: string, args: string[], msg: ParsedMessage, api: PluginAPI) => void;
  onUnload?: () => void;
}

/** Bot 客户端状态 */
export interface BotStatus {
  online: boolean;
  username: string;
  uid: string;
  uptime: number;
}
