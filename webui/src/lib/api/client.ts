import type {
  LogEntry,
  LogLevel,
  NokoriBotStatusResponse,
  NokoriBotFriend,
  NokoriBotGroup,
  PluginInfo,
} from '@/types';
import {
  type ApiClient,
  type ChangePasswordResult,
  type CreateApiClientOptions,
  type LoginResult,
  type LogsStreamOptions,
  type StreamStatus,
  type TokenStore,
  ApiError,
} from './types';

const DEFAULT_TOKEN_KEY = 'nokoribot_token';
const REQUEST_TIMEOUT_MS = 30_000;

interface ErrorPayload {
  message?: string;
  error?: string;
}

async function readJson<T>(res: Response): Promise<T> {
  try { return (await res.json()) as T; } catch { return {} as T; }
}

function extractErrorMessage(payload: ErrorPayload, fallback: string): string {
  return payload.message || payload.error || fallback;
}

class HttpApiClient implements ApiClient {
  private tokenStore: TokenStore;
  private currentToken: string | null;
  private onUnauthorized?: () => void;

  readonly plugins: ApiClient['plugins'];
  readonly friends: ApiClient['friends'];
  readonly groups: ApiClient['groups'];
  readonly config: ApiClient['config'];
  readonly logs: ApiClient['logs'];
  readonly bot: ApiClient['bot'];

  constructor(opts: CreateApiClientOptions = {}) {
    this.tokenStore = opts.tokenStore ?? {
      load: () => { try { return localStorage.getItem(DEFAULT_TOKEN_KEY); } catch { return null; } },
      save: (t) => { try { if (t) localStorage.setItem(DEFAULT_TOKEN_KEY, t); else localStorage.removeItem(DEFAULT_TOKEN_KEY); } catch { /* */ } },
    };
    this.currentToken = this.tokenStore.load();
    this.onUnauthorized = opts.onUnauthorized;

    this.plugins = {
      list: async () => {
        const data = await this.getJson<PluginInfo[] | { plugins: PluginInfo[] }>('/api/plugins');
        return Array.isArray(data) ? data : ((data as any).plugins ?? []);
      },
      toggle: async (name) => {
        const data = await this.postJson<{ success: boolean; enabled: boolean }>(`/api/plugins/${encodeURIComponent(name)}/toggle`);
        return data.enabled;
      },
      reload: async (name) => {
        await this.postJson<{ success: boolean }>(`/api/plugins/${encodeURIComponent(name)}/reload`);
      },
    };

    this.friends = {
      list: async () => this.getJson<NokoriBotFriend[]>('/api/friends'),
      request: (uid) => this.postJson('/api/contacts/friend', { uid }),
    };

    this.groups = {
      list: async () => this.getJson<NokoriBotGroup[]>('/api/groups'),
      join: (groupId) => this.postJson('/api/contacts/group', { group_id: groupId }),
    };

    this.config = {
      get: () => this.getJson<Record<string, unknown>>('/api/config'),
      save: (patch) => this.postJson('/api/config', patch),
    };

    this.logs = {
      list: async (limit = 300) => {
        const data = await this.getJson<LogEntry[] | { logs: LogEntry[] }>(`/api/logs?limit=${limit}`);
        return Array.isArray(data) ? data : ((data as any).logs ?? []);
      },
      stream: (options) => this.openLogStream(options),
      getLevel: async () => ({ level: 'info' as LogLevel, levels: ['trace','debug','info','success','warn','error'] as LogLevel[] }),
      setLevel: async (level: LogLevel) => ({ level, levels: ['trace','debug','info','success','warn','error'] as LogLevel[] }),
      exportTrace: async () => ({ text: '', filename: 'nokoribot-trace.log' }),
    };

    this.bot = {
      restart: async () => { await this.postJson('/api/bot/restart'); },
      stop: async () => { await this.postJson('/api/stop'); },
    };
  }

  // ── Auth ──

  async login(password: string): Promise<LoginResult> {
    try {
      const res = await this.fetchWithDeadline('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await readJson<{ token?: string; error?: string; message?: string }>(res);
      if (!res.ok) return { ok: false, message: extractErrorMessage(payload, '密码错误') };
      if (typeof payload.token !== 'string' || !payload.token) return { ok: false, message: extractErrorMessage(payload, '登录失败') };
      this.setToken(payload.token);
      return { ok: true, mustChangePassword: false };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '网络错误' };
    }
  }

  async logout(): Promise<void> {
    this.setToken(null);
  }

  async status(): Promise<boolean> {
    if (!this.currentToken) return false;
    try {
      const res = await this.request('/api/auth/state');
      if (!res.ok) return false;
      const data = await readJson<{ loggedIn?: boolean }>(res);
      return !!data.loggedIn;
    } catch { return false; }
  }

  async changePassword(_oldPassword: string, newPassword: string): Promise<ChangePasswordResult> {
    try {
      const data = await this.postJson<{ message?: string; error?: string }>('/api/auth/change-password', { newPassword });
      return { success: true, message: data.message ?? '密码修改成功' };
    } catch (e) {
      if (e instanceof ApiError) return { success: false, message: e.message };
      return { success: false, message: e instanceof Error ? e.message : '网络错误' };
    }
  }

  // ── Top-level resources ──

  async botStatus(): Promise<NokoriBotStatusResponse> {
    return this.getJson<NokoriBotStatusResponse>('/api/status');
  }

  // ── HTTP helpers ──

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (this.currentToken) headers['Authorization'] = `Bearer ${this.currentToken}`;
    if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const res = await this.fetchWithDeadline(url, { ...init, headers });
    if (res.status === 401) {
      this.setToken(null);
      this.onUnauthorized?.();
    }
    return res;
  }

  private async fetchWithDeadline(url: string, init: RequestInit = {}): Promise<Response> {
    const deadline = new AbortController();
    const onCallerAbort = () => deadline.abort(init.signal?.reason);
    if (init.signal?.aborted) onCallerAbort();
    else init.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: deadline.signal });
    } catch (error) {
      if (deadline.signal.aborted && !init.signal?.aborted) {
        throw new ApiError(408, '请求超时，请重试', 'REQUEST_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(url, init);
    if (!res.ok) {
      const payload = await readJson<ErrorPayload>(res);
      throw new ApiError(res.status, extractErrorMessage(payload, res.statusText || '请求失败'), payload.code);
    }
    return readJson<T>(res);
  }

  private getJson<T>(url: string): Promise<T> { return this.fetchJson<T>(url); }

  private postJson<T>(url: string, body?: unknown): Promise<T> {
    return this.fetchJson<T>(url, {
      method: 'POST',
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  // ── Token ──

  private setToken(token: string | null): void {
    this.currentToken = token;
    this.tokenStore.save(token);
  }

  // ── SSE Log Stream ──

  private openLogStream(options: LogsStreamOptions): () => void {
    if (!this.currentToken) { options.onStatus?.('closed'); return () => {}; }
    let disposed = false;
    let active: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      options.onStatus?.('reconnecting');
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, 1_000);
    };

    const connect = async () => {
      const token = this.currentToken;
      if (disposed || !token) { options.onStatus?.('closed'); return; }
      const controller = new AbortController();
      active = controller;
      try {
        const response = await fetch('/api/logs/stream', {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.status === 401) {
          disposed = true; active = null;
          this.setToken(null); this.onUnauthorized?.();
          options.onStatus?.('closed'); return;
        }
        if (!response.ok || !response.body) throw new ApiError(response.status, response.statusText || '实时连接失败');
        options.onStatus?.('open');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!disposed) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            for (;;) {
              const lf = buffer.indexOf('\n\n');
              const crlf = buffer.indexOf('\r\n\r\n');
              let sep = -1; let sepLen = 0;
              if (lf >= 0 && (crlf < 0 || lf < crlf)) { sep = lf; sepLen = 2; }
              else if (crlf >= 0) { sep = crlf; sepLen = 4; }
              if (sep < 0) break;
              const block = buffer.slice(0, sep);
              buffer = buffer.slice(sep + sepLen);
              const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
              if (!data) continue;
              try { options.onLine(JSON.parse(data) as LogEntry); } catch { /* malformed */ }
            }
          }
        } finally { reader.releaseLock(); }
        if (!disposed) scheduleReconnect();
      } catch {
        if (!disposed && !controller.signal.aborted) scheduleReconnect();
      } finally {
        if (active === controller) active = null;
      }
    };

    void connect();
    return () => {
      if (disposed) return;
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      active?.abort(); active = null;
      options.onStatus?.('closed');
    };
  }
}

export function createApiClient(options: CreateApiClientOptions = {}): ApiClient {
  return new HttpApiClient(options);
}
