// ===== 配置管理（config.json 读写） =====
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { BotConfig } from './types';
import { logger } from './logger';
import { CONFIG_PATH } from './paths';

const DEFAULT_CONFIG: BotConfig = {
  backendOrigin: 'http://oc.mcl0.dpdns.org',
  mediaOrigin: 'http://60.205.94.101:8080',
  username: '',
  password: '',
  deviceId: '',
  logLevel: 'info',
  webuiPort: 4520,
  webuiHost: '127.0.0.1',
  accessToken: '',
  refreshToken: '',
  user: null,
};

export class ConfigManager {
  private config: BotConfig;
  private readonly configPath: string;
  private listeners: Array<(cfg: BotConfig, changedKeys: string[]) => void> = [];

  constructor(configPath?: string) {
    this.configPath = configPath || CONFIG_PATH;
    this.config = this.load();
    // 设备 ID 自愈：v2 端点灰度绑定需要稳定的 X-Device-Id / device_id
    if (!this.config.deviceId) {
      this.config.deviceId = randomUUID();
      this.save();
      logger.debug(`[Config] 已生成并持久化设备 ID: ${this.config.deviceId}`);
    }
    // 配置文件不存在时自动生成（含默认服务器地址）
    if (!fs.existsSync(this.configPath)) {
      logger.info(`[Config] 配置文件不存在，已自动生成: ${this.configPath}`);
      this.save();
    }
  }

  /** 读取配置（深拷贝，避免外部修改污染） */
  get<T = any>(key?: keyof BotConfig): T {
    if (key === undefined) return this.config as unknown as T;
    return (this.config as any)[key] as T;
  }

  /** 获取完整配置副本 */
  getAll(): BotConfig {
    return { ...this.config };
  }

  /** 合并更新并持久化，返回变更的键 */
  update(partial: Partial<BotConfig>): string[] {
    const changed: string[] = [];
    for (const [k, v] of Object.entries(partial)) {
      if (v !== undefined && (this.config as any)[k] !== v) {
        (this.config as any)[k] = v;
        changed.push(k);
      }
    }
    if (changed.length > 0) {
      this.save();
      this.emit(changed);
    }
    return changed;
  }

  /** 保存到磁盘 */
  save(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e: any) {
      logger.error(`[Config] 保存配置失败: ${e.message}`);
    }
  }

  /** 从磁盘加载配置 */
  private load(): BotConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        return { ...DEFAULT_CONFIG, ...raw };
      }
    } catch (e: any) {
      logger.error(`[Config] 读取配置失败，使用默认配置: ${e.message}`);
    }
    return { ...DEFAULT_CONFIG };
  }

  /** 配置变更订阅 */
  onUpdate(listener: (cfg: BotConfig, changedKeys: string[]) => void): void {
    this.listeners.push(listener);
  }

  private emit(changedKeys: string[]): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config, changedKeys);
      } catch (e: any) {
        logger.error(`[Config] 变更监听器异常: ${e.message}`);
      }
    }
  }
}
