// ===== 结构化日志（winston） =====
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { LOG_DIR } from './paths';

// 彩色控制台输出格式
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// 文件输出格式（JSON 结构化）
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  transports: [
    // 所有日志
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
    // 仅错误日志
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
  ],
  exitOnError: false,
});

// 非生产环境附加彩色控制台输出
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: consoleFormat }));
}

/** 设置日志级别（WebUI 配置变更时调用） */
export function setLogLevel(level: string): void {
  logger.level = level;
  if (process.env.NODE_ENV !== 'production') {
    // Console transport 级别跟随 logger.level
  }
}

/** 读取最近日志行（WebUI /api/logs 使用） */
export function readRecentLogs(limit = 200): string[] {
  try {
    const file = path.join(LOG_DIR, 'combined.log');
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

/** 结构化日志行 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

/**
 * 读取最近日志并解析为结构化条目（WebUI 彩色渲染使用）。
 * combined.log 每行为 winston JSON（{ level, message, timestamp }），
 * 解析失败的行回退为原始文本（level=info, timestamp=''）。
 */
export function readStructuredLogs(limit = 300): LogEntry[] {
  const lines = readRecentLogs(limit);
  return lines.map((line) => {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object') {
        return {
          timestamp: String(obj.timestamp || ''),
          level: String(obj.level || 'info'),
          message: typeof obj.message === 'string' ? obj.message : JSON.stringify(obj.message ?? ''),
        };
      }
    } catch {
      // 非 JSON 行，回退
    }
    return { timestamp: '', level: 'info', message: line };
  });
}
