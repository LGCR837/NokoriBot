// ===== ApiClient：基于官方 OldChat API SDK 的请求封装 =====
// 协议细节（Bearer 附加、401 自动刷新、v1↔v2 路径映射与回退、ECDH 签名 + AES 信封加密、
// 候选后端降级、端点熔断、GET 去重）全部由官方 SDK 承担，本层只负责：
// - config.json ↔ SDK(localStorage) 的令牌双向桥接（SDK 内部刷新的令牌自动持久化）
// - 密码登录 / 刷新互斥调度（SDK 不含登录，由宿主实现，见 SDK README §4.2）
// - 兼容层：路径自动补 /v1 前缀、axios 风格响应解包与错误抛出
import { logger } from '../logger';
import { UserInfo } from '../types';
import { setupOldChatSdk, sdkKv, resyncSdkEndpoints, SdkHostBridge, OldChatSdk } from './sdk';

export interface ApiClientOptions {
  /** 后端 API 地址（含协议，不含 /v1 后缀）；传函数可动态读取配置（WebUI 改动即时生效） */
  backendOrigin: string | (() => string);
  /** 媒体资源地址（可选；传函数可动态读取） */
  mediaOrigin?: string | (() => string);
  /** 获取当前 access token */
  getAccessToken: () => string;
  /** 获取当前 refresh token */
  getRefreshToken: () => string;
  /** 获取当前用户信息（可选，用于桥接 oc_user） */
  getUser?: () => UserInfo | null;
  /** 获取稳定设备 ID（可选，写入 X-Device-Id 灰度绑定头，并作为登录 device_id 默认值） */
  getDeviceId?: () => string;
  /** 登录/刷新成功后回调（持久化 token / user） */
  onTokensUpdated?: (accessToken: string, refreshToken: string, user?: UserInfo | null) => void;
  /** 使用账号密码重新登录（由 BotClient 注入，避免循环依赖） */
  relogin?: () => Promise<void>;
  /** 是否已持久化 token（若为 false 则首次请求前先登录） */
  hasTokens?: () => boolean;
}

interface RawRequestConfig {
  url?: string;
  method?: string;
  data?: any;
  params?: Record<string, any>;
  headers?: Record<string, string>;
}

export class ApiClient {
  private opts: ApiClientOptions;
  private bridge: SdkHostBridge;
  /** 官方 SDK 句柄（OC 业务方法 + apiFetch 传输层），供高级用法直接调用 */
  readonly sdk: OldChatSdk;
  /** 防止多个请求同时触发刷新/重登 */
  private refreshing: Promise<void> | null = null;
  /** 上次写入 SDK 的令牌快照（用于识别 SDK 内部刷新产生的变更） */
  private lastSync = { at: '', rt: '', ur: '' };
  private timeoutMs = 40000;
  /** 当前生效的后端地址（用于检测配置变化并重同步 SDK 候选列表） */
  private lastBase = '';

  /** 动态解析后端/媒体地址 */
  private get base(): string {
    const v = this.opts.backendOrigin;
    return (typeof v === 'function' ? v() : v) || '';
  }
  private get mediaBase(): string {
    const v = this.opts.mediaOrigin;
    return (typeof v === 'function' ? v() : v) || '';
  }

  constructor(opts: ApiClientOptions) {
    this.opts = opts;
    this.bridge = {
      getAccessToken: () => this.opts.getAccessToken() || '',
      getRefreshToken: () => this.opts.getRefreshToken() || '',
      getUser: () => (this.opts.getUser ? this.opts.getUser() : null),
      setTokens: (accessToken, refreshToken, user) => {
        this.opts.onTokensUpdated?.(accessToken, refreshToken, user || null);
      },
      getBackendOrigin: () => this.base,
      getMediaOrigin: () => this.mediaBase,
      getDeviceId: () => (this.opts.getDeviceId ? this.opts.getDeviceId() : ''),
    };
    this.sdk = setupOldChatSdk(this.bridge);
    // 启动即把持久化令牌交给 SDK（后续每次请求前也会同步，防 WebUI 改配置后失联）
    this.pushTokensToSdk();
  }

  /** 登录：POST /v1/auth/login（SDK 未下沉登录，按 README §4.2 由宿主实现） */
  async login(identifier: string, password: string, deviceId?: string): Promise<UserInfo> {
    const base = this.base.replace(/\/+$/, '');
    const dev = deviceId || this.opts.getDeviceId?.() || 'nokoribot';
    const res = await this.transport(base + '/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier,
        password,
        device_id: dev,
        device_name: `NokoriBot/${process.platform}`.slice(0, 120),
        platform: 'web',
        app_version: 'web',
      }),
    });
    const data = await this.parseJson(res, '/v1/auth/login');
    if (!data.access_token) throw new Error('登录响应缺少 access_token');
    const refreshToken = data.refresh_token || '';
    const user: UserInfo = data.user || {};
    // 持久化到 config.json 并同步进 SDK
    this.opts.onTokensUpdated?.(data.access_token, refreshToken, user);
    this.pushTokensToSdk();
    logger.debug('[ApiClient] 登录成功');
    return user;
  }

  /** GET 请求 */
  async get<T = any>(path: string, params?: Record<string, any>): Promise<T> {
    await this.ensureAuth();
    return this.request<T>('GET', path, undefined, params);
  }

  /** POST 请求 */
  async post<T = any>(path: string, data?: any): Promise<T> {
    await this.ensureAuth();
    return this.request<T>('POST', path, data);
  }

  /** PUT 请求 */
  async put<T = any>(path: string, data?: any): Promise<T> {
    await this.ensureAuth();
    return this.request<T>('PUT', path, data);
  }

  /** DELETE 请求 */
  async delete<T = any>(path: string): Promise<T> {
    await this.ensureAuth();
    return this.request<T>('DELETE', path);
  }

  /** 上传（multipart/form-data；Content-Type 由 fetch 自动附带 boundary） */
  async upload<T = any>(path: string, formData: FormData): Promise<T> {
    await this.ensureAuth();
    return this.request<T>('POST', path, formData);
  }

  /** 原始请求（兼容旧 AxiosRequestConfig 形态的调用方） */
  async raw<T = any>(config: RawRequestConfig): Promise<T> {
    await this.ensureAuth();
    const method = String(config.method || 'GET').toUpperCase();
    let path = config.url || '/';
    if (config.params && !path.includes('?')) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(config.params)) qs.append(k, String(v));
      path += '?' + qs.toString();
    }
    return this.request<T>(method, path, config.data, undefined, config.headers);
  }

  // ===== 内部实现 =====

  /** 网络转接器（SDK ocTransport 同源的全局 fetch） */
  private transport(url: string, init: any): Promise<any> {
    return this.sdk.apiFetch(url, init) as Promise<any>;
  }

  /** 路径规范化：补全前导斜杠；未带版本前缀时自动加 /v1（兼容旧调用点） */
  private normalizePath(path: string): string {
    let p = path.startsWith('/') ? path : '/' + path;
    if (!/^\/v[12]\//.test(p)) p = '/v1' + p;
    return p;
  }

  /** 组装查询串（params 追加到已有 query 之后） */
  private buildUrl(path: string, params?: Record<string, any>): string {
    const p = this.normalizePath(path);
    if (!params || Object.keys(params).length === 0) return p;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
    return p + (p.includes('?') ? '&' : '?') + qs.toString();
  }

  /** 确保有有效 token：无 token 时触发刷新/重登（带并发互斥） */
  private async ensureAuth(): Promise<void> {
    this.pushTokensToSdk();
    if (this.opts.getAccessToken()) return;
    await this.doAuth();
  }

  /** 执行认证（带并发互斥）：优先 refresh token，失败则密码重登 */
  private async doAuth(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.performAuth().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** 实际执行刷新/重登（由 doAuth 互斥调用） */
  private async performAuth(): Promise<void> {
    const refreshToken = this.opts.getRefreshToken();
    if (refreshToken) {
      try {
        await this.refresh(refreshToken);
        return;
      } catch (e: any) {
        logger.warn(`[ApiClient] token 刷新失败，尝试密码重新登录: ${e.message}`);
      }
    }
    if (this.opts.relogin) {
      await this.opts.relogin();
      this.pushTokensToSdk();
      return;
    }
    throw new Error('无可用 token，且未配置账号密码');
  }

  /** POST /v1/auth/refresh 刷新令牌（直连 transport：不走 apiFetch 的 401 流程，避免递归） */
  private async refresh(refreshToken: string): Promise<void> {
    const base = this.base.replace(/\/+$/, '');
    const res = await (globalThis as any).ocTransport(base + '/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data || !data.access_token) {
      const msg =
        data && data.error
          ? typeof data.error === 'string'
            ? data.error
            : data.error.message || JSON.stringify(data.error)
          : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const user = data.user || null;
    this.opts.onTokensUpdated?.(data.access_token, data.refresh_token || refreshToken, user);
    this.pushTokensToSdk();
    logger.debug('[ApiClient] token 刷新成功');
  }

  /**
   * 统一请求入口：
   * 1. 发起请求（SDK 自动处理签名/加密/降级/内部 401 刷新）
   * 2. 失败或令牌被 SDK 清空时，做一次「重认证 + 重试」
   * 3. 响应后回读 SDK 内部令牌变化并持久化到 config.json
   */
  private async request<T>(
    method: string,
    path: string,
    data?: any,
    params?: Record<string, any>,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = { ...(extraHeaders || {}) };
    let body: any;
    if (isFormData) {
      body = data; // fetch 自动设置 multipart 边界，不可手动覆盖 Content-Type
    } else if (data !== undefined) {
      body = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
    }
    const init = { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) };

    let res: any;
    try {
      res = await this.transport(url, init);
    } catch (e: any) {
      // 认证彻底失效时 SDK 会清空令牌并抛「无可用接口版本」类错误 → 重认证后重试一次
      if (!this.isAuthFailure(e)) throw e;
      await this.doAuth();
      res = await this.transport(url, init);
    }
    if (res && res.status === 401) {
      // SDK 内部已尝试过刷新仍 401（如账号被顶下线）：密码重登后再试一次
      try {
        await this.doAuth();
        res = await this.transport(url, init);
      } catch {}
    }
    this.pullTokensFromSdk();

    if (!res || !res.ok) {
      const status = res ? res.status : 0;
      let detail = '';
      if (res) {
        const text = await res.text().catch(() => '');
        detail = this.extractErrorDetail(text);
      }
      throw new Error(`API ${status ? status + ' ' : ''}请求失败${detail ? ': ' + detail : ''}: ${url}`);
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    return this.unwrap<T>(json);
  }

  /** 判断异常是否源于认证失效（SDK 清空令牌 / 401 类错误） */
  private isAuthFailure(e: any): boolean {
    if (sdkKv.get('oc_access_token') === '' && this.lastSync.at !== '') return true;
    const msg = String(e?.message || e || '');
    return /无可用接口版本|401|invalid_session|missing_session|unauthorized/i.test(msg);
  }

  /** 从错误响应体中提取可读信息 */
  private extractErrorDetail(text: string): string {
    try {
      const j = JSON.parse(text);
      if (j && j.error) {
        return typeof j.error === 'string' ? j.error : j.error.message || j.error.msg || JSON.stringify(j.error);
      }
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  }

  /** 把 config 中的令牌/用户/设备 ID 写入 SDK（localStorage 内存桥） */
  private pushTokensToSdk(): void {
    const at = this.opts.getAccessToken() || '';
    const rt = this.opts.getRefreshToken() || '';
    const user = this.opts.getUser ? this.opts.getUser() : null;
    sdkKv.set('oc_access_token', at);
    sdkKv.set('oc_refresh_token', rt);
    const ur = user ? JSON.stringify(user) : '';
    if (ur) sdkKv.set('oc_user', ur);
    else sdkKv.set('oc_user', '');
    // X-Device-Id 灰度绑定：每次请求前保持同步
    sdkKv.set('oldchat_device_id', this.opts.getDeviceId?.() || '');
    // 后端地址变化时重同步 SDK 候选列表（WebUI 改配置即时生效，无需重启进程）
    const base = this.base;
    if (base && base !== this.lastBase) {
      this.lastBase = base;
      resyncSdkEndpoints();
    }
    this.lastSync = { at, rt, ur };
  }

  /** 回读 SDK 内部令牌变化（如 SDK 自动刷新）并持久化到 config.json */
  private pullTokensFromSdk(): void {
    const at = sdkKv.get('oc_access_token');
    const rt = sdkKv.get('oc_refresh_token');
    const ur = sdkKv.get('oc_user');
    if (at === this.lastSync.at && rt === this.lastSync.rt && ur === this.lastSync.ur) return;
    if (!at) {
      // SDK 清空了令牌（认证彻底失败）：不覆盖 config，等待重认证成功后再持久化
      logger.warn('[ApiClient] SDK 已清空会话令牌，准备重新认证');
      return;
    }
    let user: UserInfo | null = null;
    if (ur) {
      try {
        user = JSON.parse(ur);
      } catch {}
    }
    logger.debug('[ApiClient] 检测到 SDK 内部令牌更新，持久化新 token');
    this.opts.onTokensUpdated?.(at, rt, user);
    this.lastSync = { at, rt, ur };
  }

  /** 解析 JSON 响应（供 login 等直连方法复用） */
  private async parseJson(res: any, label: string): Promise<any> {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${label} 返回非 JSON 响应`);
    }
  }

  /** 统一错误处理：服务端返回 { error } 时抛出（兼容字符串/对象两种形态） */
  private unwrap<T>(data: T): T {
    if (data && typeof data === 'object' && (data as any).error) {
      const err = (data as any).error;
      const msg = typeof err === 'string' ? err : err.message || err.msg || JSON.stringify(err);
      throw new Error(msg);
    }
    return data;
  }
}
