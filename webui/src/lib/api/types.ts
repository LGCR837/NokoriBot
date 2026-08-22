import type {
  LogEntry,
  LogLevel,
  PluginInfo,
  NokoriBotStatusResponse,
  NokoriBotFriend,
  NokoriBotGroup,
} from '@/types';

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type LoginResult =
  | { ok: true; mustChangePassword: boolean }
  | { ok: false; message: string };

export type ChangePasswordResult = { success: boolean; message?: string };

export type StreamStatus = 'open' | 'reconnecting' | 'closed';

export interface LogsStreamOptions {
  onLine: (line: LogEntry) => void;
  onStatus?: (status: StreamStatus) => void;
}

export interface ApiClient {
  login(password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  status(): Promise<boolean>;
  changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResult>;

  botStatus(): Promise<NokoriBotStatusResponse>;
  plugins: {
    list(): Promise<PluginInfo[]>;
    toggle(name: string): Promise<boolean>;
    reload(name: string): Promise<void>;
  };
  friends: {
    list(): Promise<NokoriBotFriend[]>;
    request(uid: string): Promise<unknown>;
  };
  groups: {
    list(): Promise<NokoriBotGroup[]>;
    join(groupId: string): Promise<unknown>;
  };
  config: {
    get(): Promise<Record<string, unknown>>;
    save(patch: Record<string, unknown>): Promise<void>;
  };
  logs: {
    list(limit?: number): Promise<LogEntry[]>;
    stream(options: LogsStreamOptions): () => void;
    getLevel(): Promise<{ level: LogLevel; levels: LogLevel[] }>;
    setLevel(level: LogLevel): Promise<{ level: LogLevel; levels: LogLevel[] }>;
    exportTrace(): Promise<{ text: string; filename: string }>;
  };
  bot: {
    restart(): Promise<void>;
    stop(): Promise<void>;
  };

  request(url: string, init?: RequestInit): Promise<Response>;
}

export interface TokenStore {
  load(): string | null;
  save(token: string | null): void;
}

export interface CreateApiClientOptions {
  tokenStore?: TokenStore;
  onUnauthorized?: () => void;
}
