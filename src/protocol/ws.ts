// ===== WsClient：WebSocket 客户端 =====
// 移植自 oldchat-kivotos-next/src/app.js 的 initWebSocket / ensureWsSession / decryptEnvelope
// - ECDH P-256 加密握手，所有推送均为加密信封 {iv, data, mac}
// - 连接失败/断开自动重连（3s / 5s 退避）
// - 心跳保活（应用层 ping）
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { decryptEnvelope, ensureWsSession, WsSessionKeys } from './crypto';
import { logger } from '../logger';

export interface WsClientOptions {
  /** 后端地址（含协议），用于派生 WS 地址 */
  backendOrigin: string;
  /** 获取 access token */
  getAccessToken: () => string;
  /** 执行 ECDH 握手（传入客户端公钥，返回 server_pub / session_id） */
  handshake: (clientPub: string) => Promise<{ server_pub: string; session_id: string }>;
  /** 401 Token 失效时触发重新登录（返回后用新 token 重连） */
  onAuthFailed?: () => Promise<void>;
  /** 心跳间隔（毫秒），默认 25s */
  heartbeatInterval?: number;
  /** 重连基础延迟（毫秒），默认 3000 */
  reconnectDelay?: number;
}

export class WsClient extends EventEmitter {
  private opts: WsClientOptions;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private keys: WsSessionKeys | null = null;
  private manualClose = false;
  private reconnectAttempts = 0;
  private authFailed = false;

  constructor(opts: WsClientOptions) {
    super();
    this.opts = opts;
  }

  /** 连接 WS（自动完成 ECDH 握手） */
  async connect(): Promise<void> {
    this.manualClose = false;
    try {
      if (!this.keys) {
        this.keys = await ensureWsSession((clientPub) => this.opts.handshake(clientPub));
        logger.debug(`[WS] ECDH 握手成功，session=${this.keys.sessionId}`);
      }
      const token = this.opts.getAccessToken();
      if (!token || !this.keys.sessionId) throw new Error('缺少 token 或 session');

      const origin = this.opts.backendOrigin.replace(/\/+$/, '');
      const protocol = origin.startsWith('https:') ? 'wss:' : 'ws:';
      const host = origin.replace(/^https?:\/\//, '').split('/')[0];
      const wsUrl = `${protocol}//${host}/v1/ws?token=${encodeURIComponent(token)}&sid=${encodeURIComponent(this.keys.sessionId)}`;

      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => {
        logger.info('[WS] 已连接');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('open');
      });
      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
      this.ws.on('close', () => {
        this.handleClose();
      });
      this.ws.on('error', (err) => {
        logger.error(`[WS] 错误: ${err.message}`);
        if (err.message.includes('401')) this.authFailed = true;
        this.emit('error', err);
      });
    } catch (e: any) {
      logger.error(`[WS] 连接初始化失败: ${e.message}`);
      this.scheduleReconnect(5000);
    }
  }

  /** 关闭连接（不自动重连） */
  close(): void {
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.keys = null;
  }

  /** 会话密钥失效时由 BotClient 调用，强制重新握手 */
  invalidateSession(): void {
    this.keys = null;
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      // 所有 WS 推送都是加密信封，先解密
      const payload = data.toString();
      const plain = await decryptEnvelope(payload, this.keys!);
      if (!plain) {
        logger.warn('[WS] 消息解密失败（信封校验未通过）');
        return;
      }
      let msg: any;
      try {
        msg = JSON.parse(plain);
      } catch {
        logger.warn('[WS] 解密后 JSON 解析失败');
        return;
      }
      this.emit('message', msg);
    } catch (e: any) {
      logger.error(`[WS] 消息处理异常: ${e.message}`);
    }
  }

  private handleClose(): void {
    logger.info('[WS] 连接已关闭');
    this.ws = null;
    this.stopHeartbeat();
    // 会话可能已失效，清除后重新握手
    this.keys = null;
    this.emit('close');
    if (!this.manualClose) {
      if (this.authFailed && this.opts.onAuthFailed) {
        this.authFailed = false;
        logger.info('[WS] Token 失效，正在重新登录...');
        this.opts
          .onAuthFailed()
          .then(() => {
            logger.info('[WS] 重新登录成功，准备重连');
            this.scheduleReconnect(this.opts.reconnectDelay || 3000);
          })
          .catch((e: any) => {
            logger.error(`[WS] 重新登录失败: ${e.message}，稍后重试`);
            this.scheduleReconnect(this.opts.reconnectDelay || 3000);
          });
      } else {
        this.scheduleReconnect(this.opts.reconnectDelay || 3000);
      }
    }
  }

  private scheduleReconnect(delay: number): void {
    if (this.manualClose) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    logger.info(`[WS] 将在 ${Math.round(delay / 1000)}s 后重连（第 ${this.reconnectAttempts} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((e) => logger.error(`[WS] 重连失败: ${e.message}`));
    }, delay);
  }

  /** 心跳保活：周期性发送 ping（由 ws 库自动回 pong，此处用于监控活跃连接） */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.opts.heartbeatInterval || 25000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {}
      }
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
