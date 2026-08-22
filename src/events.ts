// ===== EventBus：事件总线 =====
// 轻量级事件发布/订阅，供 BotClient 内部模块与插件共用
import { EventEmitter } from 'events';

export type EventListener = (...args: any[]) => void;

export class EventBus {
  private emitter = new EventEmitter();

  /** 订阅事件（同一监听器对同一事件仅注册一次，防重复订阅） */
  on(event: string, listener: EventListener): void {
    const existing = this.emitter.listeners(event);
    if (!existing.includes(listener)) {
      this.emitter.on(event, listener);
    }
  }

  /** 取消订阅 */
  off(event: string, listener: EventListener): void {
    this.emitter.off(event, listener);
  }

  /** 单次订阅 */
  once(event: string, listener: EventListener): void {
    this.emitter.once(event, listener);
  }

  /** 发布事件（同步分发，异常隔离） */
  emit(event: string, ...args: any[]): void {
    try {
      this.emitter.emit(event, ...args);
    } catch (e: any) {
      // 单个监听器异常不应中断其他监听器
      console.error(`[EventBus] 事件 ${event} 监听器异常: ${e.message}`);
    }
  }

  /** 移除某事件的所有监听器 */
  removeAllListeners(event?: string): void {
    if (event) this.emitter.removeAllListeners(event);
    else this.emitter.removeAllListeners();
  }

  /** 某事件监听器数量 */
  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }
}
