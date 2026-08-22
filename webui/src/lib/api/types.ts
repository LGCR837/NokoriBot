import type {
  LogEntry,
  LogLevel,
  PluginInfo,
  NokoriBotStatusResponse,
  NokoriBotFriend,
  NokoriBotGroup,
  QQInfo,
  SystemInfo,
  AccountConnections,
  UpdateInfo,
  UiConfig,
  UiAppearance,
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

export interface StateStreamEvent {
  kind?: string;
  resource?: string;
  data?: unknown;
  count?: number;
}

export interface StateStreamOptions {
  onEvent: (event: StateStreamEvent) => void;
  onStatus?: (status: StreamStatus) => void;
}

export interface AgreementsPayload {
  version: string;
  consentRequired: boolean;
  documents: Array<{ id: string; title: string; declaredVersion: string; effectiveDate: string; text: string }>;
}

export interface ApiClient {
  login(password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  status(): Promise<boolean>;
  mustChangePassword(): Promise<boolean>;
  changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResult>;
  checkPasswordStrength(password: string): Promise<{ rules: unknown[]; valid: boolean }>;

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

  // SL-compat stubs
  qqList(): Promise<QQInfo[]>;
  system(): Promise<SystemInfo>;
  connections(): Promise<AccountConnections[]>;
  stateStream(options: StateStreamOptions): () => void;
  agreements: {
    get(): Promise<AgreementsPayload>;
    recordConsent(version: string): Promise<{ success: boolean; message?: string; currentVersion?: string }>;
  };
  totp: {
    status(): Promise<{ enabled: false }>;
    begin(): Promise<{ success: false; message: string }>;
    confirm(): Promise<{ success: false; message: string }>;
    disable(): Promise<{ success: boolean; message?: string }>;
    regenerateRecoveryCodes(): Promise<{ success: false; message: string }>;
  };
  update: {
    check(): Promise<UpdateInfo>;
  };
  ui: {
    get(): Promise<UiConfig>;
    save(config: Partial<UiConfig>): Promise<UiConfig>;
    getPublic(): Promise<UiAppearance>;
    uploadBackground(file: File): Promise<UiConfig>;
    deleteBackground(): Promise<UiConfig>;
  };
  systemSettings: {
    get(): Promise<Record<string, unknown>>;
    save(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
    uploadCert(cert: string, key: string): Promise<void>;
    deleteCert(): Promise<void>;
    exportBackup(includeCredentials: boolean): Promise<Record<string, unknown>>;
    importBackup(backup: Record<string, unknown>, restoreCredentials: boolean): Promise<Record<string, unknown>>;
  };
  storage: {
    get(): Promise<Record<string, unknown>>;
    saveSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
    cleanup(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  notifications: {
    getConfig(): Promise<Record<string, unknown>>;
    saveConfig(config: Record<string, unknown>): Promise<Record<string, unknown>>;
    recent(limit?: number): Promise<unknown[]>;
    test(channelId: string): Promise<{ success: boolean; message?: string }>;
  };
  globalConfig: {
    get(): Promise<Record<string, unknown>>;
    save(config: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  debug: {
    actions(): Promise<{ actions: unknown[]; categories: unknown[] }>;
    invoke(uin: string, action: string, params: Record<string, unknown>): Promise<unknown>;
    invokeStream(uin: string, action: string, params: Record<string, unknown>, onFrame: (frame: unknown) => void, signal?: AbortSignal): Promise<void>;
    upload(file: File, opts?: Record<string, unknown>): Promise<unknown>;
    stream(onMessage: (m: unknown) => void, onStatus?: (s: StreamStatus) => void): () => void;
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
