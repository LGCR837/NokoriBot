// ===== NokoriBot 主进程入口 =====
// 组装 ConfigManager / EventBus / BotClient / WebUI，处理进程信号
import path from 'path';
import { ConfigManager } from './config';
import { EventBus } from './events';
import { BotClient } from './protocol/bot';
import { startWebServer } from './webui/server';
import { logger, setLogLevel } from './logger';
import { PLUGINS_DIR } from './paths';

async function main(): Promise<void> {
  logger.info('╭──────────────────────────────────────╮');
  logger.info('│            Nokori Bot v3             │');
  logger.info('│       Powered by Aoharu Reverie      │');
  logger.info('╰──────────────────────────────────────╯');

  // 配置管理
  const config = new ConfigManager();
  setLogLevel(config.get<string>('logLevel'));

  // 事件总线
  const events = new EventBus();

  // Bot 核心
  const pluginsDir = PLUGINS_DIR;
  const bot = new BotClient({ config, events, pluginsDir });

  // 启动 WebUI（先启动，便于用户在未登录时也能访问配置页）
  startWebServer({ config, bot });

  // 启动 Bot（登录 + WS + 插件）
  try {
    await bot.start();
  } catch (e: any) {
    logger.error(`[Main] Bot 启动失败: ${e.message}`);
    logger.warn('[Main] Bot 将在后台保持运行，可通过 WebUI 配置账号后重新登录');
  }

  // 优雅退出
  const shutdown = async (signal: string) => {
    logger.info(`[Main] 收到 ${signal}，正在关闭...`);
    try {
      await bot.stop();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('[Main] NokoriBot 启动流程完成');
}

main().catch((e) => {
  console.error('[Main] 致命错误:', e);
  process.exit(1);
});
