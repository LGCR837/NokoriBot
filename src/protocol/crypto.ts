// ===== 加密辅助模块（ECDH P-256 + AES-CBC + HMAC） =====
// 直接移植自 oldchat-kivotos-next/src/app.js 的 Crypto 对象与 WS 加密流程
// 浏览器 WebCrypto (window.crypto) 替换为 Node.js globalThis.crypto (Node 18+)

import nodeCrypto from 'crypto';

// Node 18+ 内置 webcrypto（与浏览器 SubtleCrypto 兼容）
// 注意：Node 全局类型中无 DOM 的 Crypto/SubtleCrypto/BufferSource，统一按 any 处理
const webCrypto: any = (globalThis as any).crypto || (nodeCrypto as any).webcrypto;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getSubtle(): any {
  if (!webCrypto || !webCrypto.subtle) {
    throw new Error('Crypto not supported (需要 Node.js 18+)');
  }
  return webCrypto.subtle;
}

export const Crypto = {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hash = await getSubtle().digest('SHA-256', data as any);
    return new Uint8Array(hash);
  },

  async hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const key = await getSubtle().importKey('raw', keyBytes as any, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await getSubtle().sign('HMAC', key, data as any);
    return new Uint8Array(sig);
  },

  base64ToBytes(str: string): Uint8Array {
    const binary = Buffer.from(str, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },

  bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  },

  concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  },

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  },

  pkcs7Unpad(data: Uint8Array): Uint8Array {
    if (!data.length) return data;
    const pad = data[data.length - 1];
    if (pad <= 0 || pad > 16) return data;
    return data.slice(0, data.length - pad);
  },
};

/** WS 加密会话密钥集合 */
export interface WsSessionKeys {
  sessionId: string;
  encKey: Uint8Array;
  macKey: Uint8Array;
}

/**
 * ECDH P-256 握手，派生 encKey/macKey。
 * 流程（与前端 ensureWsSession 一致）：
 * 1. 生成 ECDH P-256 密钥对，导出 SPKI 公钥
 * 2. POST /v1/auth/handshake { client_pub } → { server_pub, session_id }
 * 3. ECDH 派生 256bit 共享密钥
 * 4. encKey = sha256(secret + 'enc')，macKey = sha256(secret + 'mac')
 */
export async function ensureWsSession(
  handshakeFn: (clientPub: string) => Promise<{ server_pub: string; session_id: string }>
): Promise<WsSessionKeys> {
  const subtle = getSubtle();
  const keys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const spki = await subtle.exportKey('spki', keys.publicKey);
  const clientPub = Crypto.bytesToBase64(new Uint8Array(spki));

  const data = await handshakeFn(clientPub);
  if (!data || data.server_pub === undefined || data.session_id === undefined) {
    throw new Error('握手响应缺少 server_pub/session_id');
  }

  const serverPubBytes = Crypto.base64ToBytes(data.server_pub);
  const serverPub = await subtle.importKey('spki', serverPubBytes as any, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await subtle.deriveBits({ name: 'ECDH', public: serverPub }, keys.privateKey, 256);
  const secretBytes = new Uint8Array(secret);

  const encKey = await Crypto.sha256(Crypto.concatBytes(secretBytes, textEncoder.encode('enc')));
  const macKey = await Crypto.sha256(Crypto.concatBytes(secretBytes, textEncoder.encode('mac')));

  return { sessionId: data.session_id, encKey, macKey };
}

/**
 * 解密 WS 加密信封 {iv, data, mac}（与前端 decryptEnvelope 一致）：
 * 1. HMAC-SHA256(macKey, iv || ciphertext) 校验完整性
 * 2. AES-CBC(encKey, iv) 解密
 * 3. PKCS#7 去填充 + UTF-8 解码
 */
export async function decryptEnvelope(
  payload: string | Buffer,
  keys: WsSessionKeys
): Promise<string | null> {
  if (!keys || !keys.encKey || !keys.macKey) return null;
  let env: any;
  try {
    env = JSON.parse(payload.toString());
  } catch {
    return null;
  }
  if (!env.iv || !env.data || !env.mac) return null;

  const iv = Crypto.base64ToBytes(env.iv);
  const ciphertext = Crypto.base64ToBytes(env.data);
  const mac = Crypto.base64ToBytes(env.mac);

  const expected = await Crypto.hmacSha256(keys.macKey, Crypto.concatBytes(iv, ciphertext));
  if (!Crypto.timingSafeEqual(mac, expected)) return null;

  const subtle = getSubtle();
  const key = await subtle.importKey('raw', keys.encKey as any, { name: 'AES-CBC' }, false, ['decrypt']);
  const plainBuf = await subtle.decrypt({ name: 'AES-CBC', iv: iv as any }, key, ciphertext as any);
  const plainBytes = Crypto.pkcs7Unpad(new Uint8Array(plainBuf));
  return textDecoder.decode(plainBytes);
}

/** 导出文本编码器（供其他模块复用） */
export const encoder = textEncoder;
