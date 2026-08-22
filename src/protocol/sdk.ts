// ===== OldChat API SDK 宿主适配层（Node.js） =====
// 以「经典 <script> 标签」语义在 Node 中运行官方 SDK（src/oldchat-api-sdk-javascript，禁止改动）：
// - vm.runInThisContext 使 SDK 顶层 function 声明（apiFetch/refreshEndpoints/resolveMediaUrl…）
//   自动挂到全局——业务层 IIFE 加载时才能捕获 global.apiFetch；普通 require() 的模块作用域做不到
// - 补齐浏览器全局：window / localStorage / crypto / location（atob·btoa·fetch·Response 为 Node 原生）
// - 注入网络转接器 window.ocTransport = 全局 fetch
// - 注入 __httpSession：HTTP v2 签名专用 ECDH 会话（与 WS 会话严格分离，见 SDK README §4.3）
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import nodeCrypto from 'crypto';
import { logger } from '../logger';
import { ensureWsSession } from './crypto';

const g = globalThis as any;

/** 宿主桥接回调（由 ApiClient 注入：令牌与后端地址在 config.json ↔ SDK 间双向同步） */
export interface SdkHostBridge {
  getAccessToken(): string;
  getRefreshToken(): string;
  getUser(): any | null;
  /** SDK 内部自动刷新产生新令牌时回调（持久化到 config.json） */
  setTokens(accessToken: string, refreshToken: string, user?: any | null): void;
  getBackendOrigin(): string;
  getMediaOrigin?(): string;
  /** 稳定设备 ID（X-Device-Id 灰度绑定；空则不发送该头） */
  getDeviceId?(): string;
}

export interface OldChatSdk {
  OC: Record<string, any>;
  OCError: any;
  apiFetch: (url: string, init?: any) => Promise<any>;
  refreshEndpoints: () => void;
  resolveMediaUrl: (url: string) => string;
}

let initialized = false;
let bridge: SdkHostBridge | null = null;

// localStorage 内存实现：SDK 每次请求都从这里读令牌；
// ApiClient 在请求前写入 config 中的令牌、响应后回读差异并持久化
const kvStore = new Map<string, string>();

/** SDK 键值读取（供 ApiClient 桥接） */
export const sdkKv = {
  get(key: string): string {
    return kvStore.has(key) ? (kvStore.get(key) as string) : '';
  },
  set(key: string, value: string): void {
    kvStore.set(key, value === undefined || value === null ? '' : String(value));
  },
};

function ensureBrowserGlobals(): void {
  // window：SDK 以 typeof window 判定宿主，全部全局对象挂在 window 上
  if (!g.window) g.window = g;
  // crypto：Node 18 默认无全局 crypto（19+ 才有），用 node:crypto 的 webcrypto 补齐
  if (!g.crypto) g.crypto = (nodeCrypto as any).webcrypto;
  // localStorage：SDK 模块加载时即会读取，必须先于 SDK 就位。
  // 注意：新版 Node 自带实验性 localStorage（依赖 --localstorage-file 且可能不可用），
  // 这里必须强制覆盖为内存实现——令牌由 ApiClient 与 config.json 双向桥接
  const memStorage = {
    getItem: (k: string) => (kvStore.has(k) ? (kvStore.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      kvStore.set(String(k), String(v));
    },
    removeItem: (k: string) => {
      kvStore.delete(k);
    },
    clear: () => {
      kvStore.clear();
    },
    key: (i: number) => Array.from(kvStore.keys())[i] ?? null,
    get length() {
      return kvStore.size;
    },
  };
  Object.defineProperty(g, 'localStorage', {
    value: memStorage,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  // location：仅浏览器存在。SDK 认证彻底失败时会跳转 login.html 并清空令牌，
  // 这里提供空实现避免抛错（清空令牌后由 ApiClient 走密码重登自愈）
  if (!g.location) {
    g.location = {
      _href: '',
      set href(v: string) {
        logger.warn(`[SdkHost] SDK 触发页面跳转（已忽略）: ${v}，将由框架自动重新登录`);
        this._href = v;
      },
      get href() {
        return this._href;
      },
    };
  }
}

/** 注入网络转接器与 HTTP v2 签名会话 */
let transportImpl: ((input: any, init?: any) => Promise<any>) | null = null;

/**
 * 确定网络转接器实现并固定引用：
 * - 宿主可预先注入自定义 ocTransport（如离线测试桩），此时固定采用该引用；
 * - 否则默认使用 Node 全局 fetch（Node 18+）。
 * 注意必须保存函数引用本身——SDK 加载后其自带的同名占位声明会覆盖全局属性。
 */
function prepareTransport(): void {
  if (!transportImpl) {
    if (typeof g.ocTransport === 'function') {
      transportImpl = g.ocTransport;
    } else {
      transportImpl = (input: any, init?: any) => fetch(input as any, init);
    }
  }
}

/** 把真实转接器落位到全局（须在 SDK 加载后执行以覆盖其占位实现） */
function applyTransport(): void {
  if (!transportImpl) prepareTransport();
  g.ocTransport = transportImpl;
}

/** 注入 HTTP v2 签名会话 */
function injectHttpSession(): void {

  // __httpSession：HTTP v2 签名专用 ECDH 会话。
  // 注意必须与 WS 会话（WsClient 内部密钥）完全隔离——HTTP 侧 401 会 clear 重握手，
  // 若共用会把存活的 WS 连接搞聋（SDK 源码注释明确警告）
  if (!g.__httpSession) {
    const sess: any = {
      _ready: false,
      _keys: null as { sessionId: string; encKey: Uint8Array; macKey: Uint8Array } | null,
      _pending: null as Promise<void> | null,
      async ensure(): Promise<void> {
        if (this._ready && this._keys) return;
        if (!this._pending) {
          this._pending = (async () => {
            const keys = await ensureWsSession(async (clientPub: string) => {
              // 握手走裸 transport 直连配置后端：auth/handshake 不在 v1↔v2 映射表内，无需签名，
              // 且绝不能经由 apiFetch 发起（签名流程自身依赖本会话，会递归）
              const base = String(bridge?.getBackendOrigin() || '').replace(/\/+$/, '');
              const res = await g.ocTransport(base + '/v1/auth/handshake', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + (bridge?.getAccessToken() || ''),
                },
                body: JSON.stringify({ client_pub: clientPub }),
              });
              const data = await res.json();
              if (data && data.error) {
                throw new Error(
                  typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error)
                );
              }
              return data;
            });
            this._keys = keys;
            this._ready = true;
            logger.debug('[SdkHost] HTTP v2 签名会话已建立');
          })()
            .catch((e: any) => {
              this._ready = false;
              this._keys = null;
              logger.warn(`[SdkHost] HTTP v2 握手失败: ${e.message}`);
              throw e;
            })
            .finally(() => {
              this._pending = null;
            });
        }
        return this._pending;
      },
      getMacKey() {
        return this._keys?.macKey;
      },
      getEncKey() {
        return this._keys?.encKey;
      },
      getSessionId() {
        return this._keys?.sessionId;
      },
      clear() {
        this._ready = false;
        this._keys = null;
      },
    };
    g.__httpSession = sess;
  }
}

/** 把配置中的后端/媒体地址、设备 ID 同步进 SDK 并重算端点 */
function syncEndpointCandidates(): void {
  const backend = String(bridge?.getBackendOrigin() || '').trim();
  if (backend) sdkKv.set('oc_custom_base_url', backend);
  const media = String(bridge?.getMediaOrigin?.() || '').trim();
  if (media) sdkKv.set('oc_custom_media_url', media);
  const deviceId = String(bridge?.getDeviceId?.() || '').trim();
  if (deviceId) sdkKv.set('oldchat_device_id', deviceId);
  try {
    g.refreshEndpoints?.();
  } catch {}
}

/** 配置中的后端地址发生变化时，由 ApiClient 触发重新同步候选列表 */
export function resyncSdkEndpoints(): void {
  if (!initialized) return;
  syncEndpointCandidates();
}

/** 以经典脚本语义执行 SDK 文件（顶层 function 声明挂到全局，业务层可捕获 apiFetch） */
function loadSdkFile(): void {
  const file = path.join(__dirname, '..', 'oldchat-api-sdk-javascript', 'oldchat-api-sdk.js');
  const code = fs.readFileSync(file, 'utf8');
  // SDK 末尾 `module.exports = { OC, OCError }`：临时提供全局 module 供其写入
  const fakeModule = { exports: {} as any };
  const hadModule = Object.prototype.hasOwnProperty.call(g, 'module');
  const prevModule = g.module;
  g.module = fakeModule;
  try {
    vm.runInThisContext(code, { filename: 'oldchat-api-sdk.js' });
  } finally {
    if (hadModule) g.module = prevModule;
    else delete g.module;
  }
  if (!g.OC) throw new Error('OldChat API SDK 加载失败（未导出 OC）');
  if (typeof g.apiFetch !== 'function') {
    throw new Error('OldChat API SDK 加载失败（未捕获到传输层 apiFetch）');
  }
  logger.debug(`[SdkHost] OldChat API SDK 已加载: ${file}`);
}

/**
 * 初始化官方 SDK（幂等）：补齐浏览器全局 → 注入 ocTransport/__httpSession → 加载 SDK → 同步端点候选。
 * 返回 SDK 句柄（OC 业务方法 / apiFetch 传输层），供 ApiClient 与插件高级用法直接调用。
 */
export function setupOldChatSdk(b: SdkHostBridge): OldChatSdk {
  bridge = b;
  ensureBrowserGlobals();
  prepareTransport();
  injectHttpSession();
  if (!initialized) {
    initialized = true;
    loadSdkFile();
  }
  // SDK 加载后其占位 ocTransport 会覆盖全局同名属性，这里重新落位真实实现
  applyTransport();
  syncEndpointCandidates();
  return {
    OC: g.OC,
    OCError: g.OCError,
    apiFetch: (url: string, init?: any) => g.apiFetch(url, init),
    refreshEndpoints: () => g.refreshEndpoints?.(),
    resolveMediaUrl: (url: string) => (g.resolveMediaUrl ? g.resolveMediaUrl(url) : url),
  };
}
