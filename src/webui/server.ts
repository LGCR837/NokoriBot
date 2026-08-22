// ===== WebUI 服务器（Express，端口 4520） =====
// 提供插件管理、Bot 配置、日志查看的 REST API 与前端静态页面
import express, { Express, Request, Response, Router } from 'express';
import path from 'path';
import { ConfigManager } from '../config';
import { BotClient } from '../protocol/bot';
import { logger, readRecentLogs, readStructuredLogs, setLogLevel } from '../logger';
import { WEBUI_PUBLIC_DIR } from '../paths';
import { toUidParam } from '../protocol/ncuid';

export interface WebUiOptions {
  config: ConfigManager;
  bot: BotClient;
  port?: number;
  host?: string;
}

export function createWebServer(opts: WebUiOptions): Express {
  const { config, bot } = opts;
  const app = express();
  app.use(express.json());

  const apiRouter = Router();

  // ===== 插件管理 =====

  // 获取所有插件信息
  apiRouter.get('/plugins', (_req: Request, res: Response) => {
    const plugins = bot.plugins.getAllPlugins();
    res.json({ plugins });
  });

  // 切换插件启用状态
  apiRouter.post('/plugins/:name/toggle', async (req: Request, res: Response) => {
    try {
      const enabled = await bot.plugins.togglePlugin(req.params.name);
      res.json({ success: true, enabled });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 重载单个插件
  apiRouter.post('/plugins/:name/reload', async (req: Request, res: Response) => {
    try {
      await bot.plugins.reloadPlugin(req.params.name);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 读取插件配置（config.json）
  apiRouter.get('/plugins/:name/config', (req: Request, res: Response) => {
    try {
      const config = bot.plugins.getPluginConfig(req.params.name);
      res.json({ config });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 保存插件配置（config.json）
  apiRouter.post('/plugins/:name/config', (req: Request, res: Response) => {
    try {
      const config = req.body?.config;
      if (!config || typeof config !== 'object') {
        res.status(400).json({ success: false, error: '请求体需包含 config 对象' });
        return;
      }
      bot.plugins.savePluginConfig(req.params.name, config);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // ===== 联系人管理 =====

  // 获取所有联系人与群组
  apiRouter.get('/contacts', async (_req: Request, res: Response) => {
    try {
      const [friends, groups] = await Promise.all([bot.getFriends(true), bot.getGroups(true)]);
      res.json({ friends, groups });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 添加好友（发送好友申请）
  apiRouter.post('/contacts/friend', async (req: Request, res: Response) => {
    try {
      const uid = String(req.body?.uid || '').trim();
      if (!uid) {
        res.status(400).json({ success: false, error: '缺少 uid' });
        return;
      }
      const data = await bot.api.post('/friends/request', toUidParam(uid));
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 加入群组
  apiRouter.post('/contacts/group', async (req: Request, res: Response) => {
    try {
      const groupId = String(req.body?.group_id || '').trim();
      if (!groupId) {
        res.status(400).json({ success: false, error: '缺少 group_id' });
        return;
      }
      const data = await bot.api.post('/groups/join', { group_id: groupId });
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // ===== Bot 状态与操作 =====

  // 获取 Bot 状态
  apiRouter.get('/bot/status', (_req: Request, res: Response) => {
    const status = bot.getStatus();
    res.json({
      online: status.online,
      username: status.username,
      uid: status.uid,
      uptime: status.uptime,
    });
  });

  // 手动触发登录
  apiRouter.post('/bot/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body || {};
      if (username || password) {
        if (username) config.update({ username } as any);
        if (password) config.update({ password } as any);
      }
      const u = config.get<string>('username');
      const p = config.get<string>('password');
      if (!u || !p) {
        res.status(400).json({ success: false, error: '请在配置中填写账号密码' });
        return;
      }
      await bot.restart();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 重启 Bot 核心（重新登录+重连）
  apiRouter.post('/bot/restart', async (_req: Request, res: Response) => {
    try {
      await bot.restart();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 关闭 Bot（先优雅停止：关闭插件与 WS；10 秒超时未完成则强制退出；前端需双重确认）
  apiRouter.post('/stop', async (_req: Request, res: Response) => {
    try {
      res.json({ success: true });
      logger.info('[WebUI] 收到关闭指令，正在停止 Bot...');
      setTimeout(() => {
        let finished = false;
        // 10s 超时兜底：优雅停止未完成则强制退出
        const forceTimer = setTimeout(() => {
          if (!finished) {
            logger.warn('[WebUI] 停止超时（10s），强制退出进程');
            process.exit(1);
          }
        }, 10000);
        bot
          .stop()
          .then(() => {
            finished = true;
            clearTimeout(forceTimer);
            logger.info('[WebUI] Bot 已优雅停止，退出进程');
            process.exit(0);
          })
          .catch((e: any) => {
            finished = true;
            clearTimeout(forceTimer);
            logger.warn(`[WebUI] 停止 Bot 异常: ${e.message}，退出进程`);
            process.exit(1);
          });
      }, 300);
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // ===== 配置管理 =====

  // 获取当前配置（隐藏密码与 token）
  apiRouter.get('/config', (_req: Request, res: Response) => {
    const cfg = config.getAll();
    res.json({
      backendOrigin: cfg.backendOrigin,
      mediaOrigin: cfg.mediaOrigin,
      username: cfg.username,
      logLevel: cfg.logLevel,
      webuiPort: cfg.webuiPort,
      user: cfg.user,
    });
  });

  // 更新配置（合并更新 + 持久化）
  apiRouter.post('/config', (req: Request, res: Response) => {
    const body = req.body || {};
    const update: Record<string, any> = {};
    const allowed = ['backendOrigin', 'mediaOrigin', 'username', 'password', 'logLevel', 'webuiPort'];
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ success: false, error: '没有可更新的字段' });
      return;
    }
    config.update(update as any);
    if (update.logLevel) setLogLevel(update.logLevel);
    logger.info(`[WebUI] 配置已更新: ${Object.keys(update).join(', ')}`);
    res.json({ success: true });
  });

  // ===== 日志 =====

  // 获取最近日志（结构化，供前端彩色渲染）
  apiRouter.get('/logs', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || 300), 10) || 300, 1000);
    res.json({ logs: readStructuredLogs(limit) });
  });

  // 挂载 API 路由与静态文件
  app.use('/api', apiRouter);
  const publicDir = WEBUI_PUBLIC_DIR;
  app.use(express.static(publicDir));

  return app;
}

/** 启动 WebUI 服务器 */
export function startWebServer(opts: WebUiOptions): void {
  const app = createWebServer(opts);
  const port = opts.port || opts.config.get<number>('webuiPort') || 4520;
  // 监听地址：优先显式传入 → 配置文件 webuiHost（默认 127.0.0.1；KataBump/容器公网部署时改为 0.0.0.0）
  const host = opts.host || opts.config.get<string>('webuiHost') || '127.0.0.1';
  app.listen(port, host, () => {
    logger.info(`[WebUI] 管理界面已启动: http://${host}:${port}`);
  });
}
