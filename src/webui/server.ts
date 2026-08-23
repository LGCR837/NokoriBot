// ===== WebUI 服务器（Express，端口 4520） =====
// 提供插件管理、Bot 配置、日志查看的 REST API 与 React 前端 SPA
import express, { Express, Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { ConfigManager } from '../config';
import { BotClient } from '../protocol/bot';
import { logger, readRecentLogs, readStructuredLogs, setLogLevel } from '../logger';
import { WEBUI_PUBLIC_DIR, PLUGINS_DIR } from '../paths';
import { toUidParam } from '../protocol/ncuid';

export interface WebUiOptions {
  config: ConfigManager;
  bot: BotClient;
  port?: number;
  host?: string;
}

// ===== 简易 JWT 实现 =====
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

function createToken(): string {
  const payload = { iat: Date.now(), exp: Date.now() + TOKEN_TTL };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token: string): boolean {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

// 密码哈希（SHA-512 + salt，与旧版兼容）
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha512').update(s + password).digest('hex');
  return { hash, salt: s };
}

function getPasswordHash(config: ConfigManager): { hash: string; salt: string } | null {
  const cfg = config.getAll() as any;
  if (cfg.webuiPasswordHash && cfg.webuiPasswordSalt) {
    return { hash: cfg.webuiPasswordHash, salt: cfg.webuiPasswordSalt };
  }
  return null;
}

// 独立密码系统：首次访问时无密码，用户自行设置

export function createWebServer(opts: WebUiOptions): Express {
  const { config, bot } = opts;
  const app = express();
  app.use(express.json());

  // 不再自动设置密码，由用户首次访问时自行设置

  const apiRouter = Router();

  // ===== 认证 =====

  // 检查是否已设置密码（首次访问时返回 false，前端显示设置密码表单）
  apiRouter.get('/auth/has-password', (_req: Request, res: Response) => {
    const stored = getPasswordHash(config);
    res.json({ hasPassword: stored !== null });
  });

  // 登录：验证密码，返回 JWT
  // 如果未设置密码，任意密码均可登录并自动设置
  apiRouter.post('/login', (req: Request, res: Response) => {
    const { password } = req.body || {};
    if (!password) {
      res.status(400).json({ error: '请输入密码' });
      return;
    }
    const stored = getPasswordHash(config);
    if (!stored) {
      // 首次登录，自动设置密码
      const { hash, salt } = hashPassword(password);
      config.update({ webuiPasswordHash: hash, webuiPasswordSalt: salt } as any);
      const token = createToken();
      res.json({ token, message: '密码已设置，登录成功' });
      return;
    }
    const { hash } = hashPassword(password, stored.salt);
    if (hash !== stored.hash) {
      res.status(401).json({ error: '密码错误' });
      return;
    }
    const token = createToken();
    res.json({ token, message: '登录成功' });
  });

  // 验证 token
  apiRouter.get('/auth/state', (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ') && verifyToken(auth.slice(7))) {
      res.json({ loggedIn: true });
    } else {
      res.json({ loggedIn: false });
    }
  });

  // 修改密码
  // 如果 oldPassword 为空且当前无密码，直接设置新密码
  apiRouter.post('/auth/change-password', (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ') || !verifyToken(auth.slice(7))) {
      res.status(401).json({ error: '未登录' });
      return;
    }
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword) {
      res.status(400).json({ error: '请提供新密码' });
      return;
    }
    const stored = getPasswordHash(config);
    if (!stored) {
      // 无密码，直接设置
      const { hash, salt } = hashPassword(newPassword);
      config.update({ webuiPasswordHash: hash, webuiPasswordSalt: salt } as any);
      res.json({ message: '密码设置成功' });
      return;
    }
    if (!oldPassword) {
      res.status(400).json({ error: '请提供旧密码' });
      return;
    }
    const { hash: oldHash } = hashPassword(oldPassword, stored.salt);
    if (oldHash !== stored.hash) {
      res.status(401).json({ error: '旧密码错误' });
      return;
    }
    const { hash, salt } = hashPassword(newPassword);
    config.update({ webuiPasswordHash: hash, webuiPasswordSalt: salt } as any);
    res.json({ message: '密码修改成功' });
  });

  // ===== 认证中间件 =====
  const requireAuth = (req: Request, res: Response, next: Function) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ') && verifyToken(auth.slice(7))) {
      next();
    } else {
      res.status(401).json({ error: '未登录' });
    }
  };

  // ===== Bot 状态 =====

  apiRouter.get('/status', requireAuth, (_req: Request, res: Response) => {
    const status = bot.getStatus();
    const mem = process.memoryUsage();
    const plugins = bot.plugins.getAllPlugins();
    const cpus = require('os').cpus();
    const cpuModel = cpus[0]?.model ?? 'Unknown';
    const cpuCores = cpus.length;
    // Simple CPU usage: compare idle vs total over a short window
    const cpuTimes = cpus.reduce((acc: any, cpu: any) => {
      acc.user += cpu.times.user;
      acc.nice += cpu.times.nice;
      acc.sys += cpu.times.sys;
      acc.idle += cpu.times.idle;
      acc.irq += cpu.times.irq;
      return acc;
    }, { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 });
    const total = cpuTimes.user + cpuTimes.nice + cpuTimes.sys + cpuTimes.idle + cpuTimes.irq;
    const cpuUsage = total > 0 ? ((total - cpuTimes.idle) / total) * 100 : 0;
    res.json({
      bot: {
        running: status.online || false,
        loggedIn: status.online || false,
        myUid: status.uid || null,
        username: status.username || null,
        backendOrigin: config.get<string>('backendOrigin') || '',
        mediaOrigin: config.get<string>('mediaOrigin') || '',
        deviceId: config.get<string>('deviceId') || '',
      },
      uptime: status.uptime || 0,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      cpu: { model: cpuModel, cores: cpuCores, usage: Math.round(cpuUsage * 10) / 10 },
      plugins: Array.isArray(plugins) ? plugins : [],
    });
  });

  // ===== 插件管理 =====

  apiRouter.get('/plugins', requireAuth, (_req: Request, res: Response) => {
    const plugins = bot.plugins.getAllPlugins();
    res.json(Array.isArray(plugins) ? plugins : []);
  });

  apiRouter.post('/plugins/:name/toggle', requireAuth, async (req: Request, res: Response) => {
    try {
      const enabled = await bot.plugins.togglePlugin(req.params.name);
      res.json({ success: true, enabled });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.post('/plugins/:name/reload', requireAuth, async (req: Request, res: Response) => {
    try {
      await bot.plugins.reloadPlugin(req.params.name);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.get('/plugins/:name/config', requireAuth, (req: Request, res: Response) => {
    try {
      const config = bot.plugins.getPluginConfig(req.params.name);
      res.json({ config });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.post('/plugins/:name/config', requireAuth, (req: Request, res: Response) => {
    try {
      const config = req.body?.config ?? {};
      bot.plugins.savePluginConfig(req.params.name, config);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ===== 联系人 =====

  apiRouter.get('/friends', requireAuth, async (_req: Request, res: Response) => {
    try {
      const friends = await bot.getFriends(true);
      res.json(Array.isArray(friends) ? friends : []);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.get('/groups', requireAuth, async (_req: Request, res: Response) => {
    try {
      const groups = await bot.getGroups(true);
      res.json(Array.isArray(groups) ? groups : []);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.post('/contacts/friend', requireAuth, async (req: Request, res: Response) => {
    try {
      const uid = String(req.body?.uid || '').trim();
      if (!uid) { res.status(400).json({ error: '缺少 uid' }); return; }
      const data = await bot.api.post('/friends/request', toUidParam(uid));
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.post('/contacts/group', requireAuth, async (req: Request, res: Response) => {
    try {
      const groupId = String(req.body?.group_id || '').trim();
      if (!groupId) { res.status(400).json({ error: '缺少 group_id' }); return; }
      const data = await bot.api.post('/groups/join', { group_id: groupId });
      res.json({ success: true, data });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ===== Bot 操作 =====

  apiRouter.get('/bot/status', requireAuth, (_req: Request, res: Response) => {
    const status = bot.getStatus();
    res.json({ online: status.online, username: status.username, uid: status.uid, uptime: status.uptime });
  });

  apiRouter.post('/bot/login', requireAuth, async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body || {};
      if (username) config.update({ username } as any);
      if (password) config.update({ password } as any);
      await bot.restart();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.post('/bot/restart', requireAuth, async (_req: Request, res: Response) => {
    try {
      await bot.restart();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  apiRouter.post('/stop', requireAuth, async (_req: Request, res: Response) => {
    try {
      res.json({ success: true });
      logger.info('[WebUI] 收到关闭指令，正在停止 Bot...');
      setTimeout(() => {
        bot.stop().then(() => process.exit(0)).catch(() => process.exit(1));
      }, 300);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ===== 插件广场 =====

  const MARKETPLACE_URL = 'https://ii.reverie.dpdns.org/nokorimarketplace';

  apiRouter.get('/marketplace/plugins', requireAuth, async (_req: Request, res: Response) => {
    try {
      const resp = await fetch(`${MARKETPLACE_URL}/api.php?action=plugins`);
      const data = await resp.json();
      res.json(data);
    } catch (e: any) {
      res.status(502).json({ error: '无法连接插件广场: ' + e.message });
    }
  });

  apiRouter.post('/marketplace/install', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, version } = req.body || {};
      if (!name) { res.status(400).json({ error: '缺少插件名' }); return; }

      // 从广场下载 zip
      const listResp = await fetch(`${MARKETPLACE_URL}/api.php?action=plugins`);
      const listData = await listResp.json();
      const plugins = Array.isArray(listData) ? listData : (listData.plugins ?? []);
      const plugin = plugins.find((p: any) => p.name === name);
      if (!plugin) { res.status(404).json({ error: '广场中没有该插件' }); return; }

      const downloadUrl = `${MARKETPLACE_URL}/api.php?action=download&id=${encodeURIComponent(plugin.name)}`;
      const zipResp = await fetch(downloadUrl);
      if (!zipResp.ok) { res.status(502).json({ error: '下载失败' }); return; }
      const zipBuf = Buffer.from(await zipResp.arrayBuffer());

      // 解压到临时目录
      const zip = new AdmZip(zipBuf);
      const entries = zip.getEntries();

      // 分析结构：找 manifest.json
      let rootPrefix = '';
      const manifestEntry = entries.find((e: any) => e.entryName.endsWith('/manifest.json') || e.entryName === 'manifest.json');
      if (!manifestEntry) { res.status(400).json({ error: 'zip 中没有 manifest.json' }); return; }
      const manifestJson = manifestEntry.getData().toString('utf8');
      const manifest = JSON.parse(manifestJson);
      const pluginName = manifest.name || name;

      // 判断是否有根目录前缀
      if (manifestEntry.entryName !== 'manifest.json') {
        rootPrefix = manifestEntry.entryName.replace('manifest.json', '');
      }

      const destDir = path.join(PLUGINS_DIR, pluginName);

      // 保存旧 config.json
      let oldConfig: string | null = null;
      const configPath = path.join(destDir, 'config.json');
      if (fs.existsSync(configPath)) {
        oldConfig = fs.readFileSync(configPath, 'utf8');
      }

      // 清理旧文件（保留 meta.json 和 config.json）
      if (fs.existsSync(destDir)) {
        for (const f of fs.readdirSync(destDir)) {
          if (f === 'meta.json' || f === 'config.json') continue;
          const fp = path.join(destDir, f);
          fs.rmSync(fp, { recursive: true, force: true });
        }
      }
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      // 解压所有文件
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        let targetName = entry.entryName;
        if (rootPrefix && targetName.startsWith(rootPrefix)) {
          targetName = targetName.slice(rootPrefix.length);
        }
        if (!targetName || targetName === 'manifest.json') continue;
        const targetPath = path.join(destDir, targetName);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, entry.getData());
      }

      // 恢复旧 config.json
      if (oldConfig) {
        fs.writeFileSync(configPath, oldConfig, 'utf8');
      }

      logger.info(`[Marketplace] 已安装插件 ${pluginName} v${manifest.version || '?'}`);
      res.json({ success: true, name: pluginName, version: manifest.version });
    } catch (e: any) {
      logger.error(`[Marketplace] 安装失败: ${e.message}`);
      res.status(500).json({ error: '安装失败: ' + e.message });
    }
  });

  // ===== 配置 =====

  apiRouter.get('/config', requireAuth, (_req: Request, res: Response) => {
    const cfg = config.getAll();
    res.json({
      backendOrigin: cfg.backendOrigin,
      mediaOrigin: cfg.mediaOrigin,
      logLevel: cfg.logLevel,
      webuiPort: cfg.webuiPort,
      webuiHost: cfg.webuiHost,
      deviceId: cfg.deviceId,
      user: (cfg as any).user,
    });
  });

  apiRouter.post('/config', requireAuth, (req: Request, res: Response) => {
    const body = req.body || {};
    const allowed = ['backendOrigin', 'mediaOrigin', 'logLevel', 'webuiPort', 'webuiHost'];
    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: '没有可更新的字段' });
      return;
    }
    config.update(update as any);
    if (update.logLevel) setLogLevel(update.logLevel);
    logger.info(`[WebUI] 配置已更新: ${Object.keys(update).join(', ')}`);
    res.json({ message: '配置已更新' });
  });

  // ===== 日志 =====

  apiRouter.get('/logs', requireAuth, (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || 300), 10) || 300, 1000);
    const logs = readStructuredLogs(limit);
    res.json(Array.isArray(logs) ? logs : []);
  });

  // SSE 实时日志流
  apiRouter.get('/logs/stream', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: {"type":"connected"}\n\n');

    const interval = setInterval(() => {
      const logs = readStructuredLogs(10);
      if (Array.isArray(logs) && logs.length > 0) {
        for (const entry of logs) {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }
      }
    }, 2000);

    req.on('close', () => clearInterval(interval));
  });

  // SSE 实时状态流
  apiRouter.get('/status/stream', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: {"type":"connected"}\n\n');

    const interval = setInterval(() => {
      const status = bot.getStatus();
      const mem = process.memoryUsage();
      res.write(`data: ${JSON.stringify({ bot: { running: status.online, loggedIn: status.online, myUid: status.uid }, memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal } })}\n\n`);
    }, 5000);

    req.on('close', () => clearInterval(interval));
  });

  // ===== 挂载 API 路由 =====
  app.use('/api', apiRouter);

  // ===== UI 配置 stub（前端 ThemeContext 需要） =====
  const defaultAppearance = {
    mode: 'dark', accentMode: 'preset', accentPreset: 'default', accentCustom: '#0ea5e9',
    accentScope: 'global', darkIntensity: 'soft', palette: 'default', sidebarStyle: 'follow',
    background: { type: 'none', color: '', gradient: '', imageOpacity: 1, imageBlur: 0, hasImage: false, imageMime: '', imageVersion: 0 },
    fontSans: 'default', fontSansCustom: '', fontMono: 'default', fontMonoCustom: '',
    uiScale: 1, radius: 0.75, density: 'cozy', reduceMotion: false, disableMotion: false,
    customPointerSystem: false, customContextMenu: false, highContrast: false,
    sidebarPinned: true, timeFormat: '24h', pollInterval: 3000, customCss: '', cssVars: {},
  };
  const defaultLayout = {
    overviewBlocks: [], overviewMobile: [],
    navItems: [], topbarItems: [],
  };
  const defaultPages = { defaultRoute: '/', logs: { visibleLevels: ['info','warn','error'], maxLines: 500, autoScroll: true, wrap: false, highlightRules: [], preset: 'ops' as const }, processesSort: '', configTab: '' };
  const defaultUiConfig = { version: 1, appearance: defaultAppearance, layout: defaultLayout, pages: defaultPages };

  // 持久化 UI 配置到 config.json
  function getUiConfig(): typeof defaultUiConfig {
    try {
      const stored = (config.getAll() as any).uiConfig;
      if (stored && typeof stored === 'object') {
        return {
          version: stored.version ?? 1,
          appearance: { ...defaultAppearance, ...(stored.appearance || {}) },
          layout: { ...defaultLayout, ...(stored.layout || {}) },
          pages: { ...defaultPages, ...(stored.pages || {}) },
        };
      }
    } catch { /* */ }
    return defaultUiConfig;
  }

  apiRouter.get('/ui', requireAuth, (_req: Request, res: Response) => {
    res.json({ config: getUiConfig() });
  });

  apiRouter.post('/ui', requireAuth, (req: Request, res: Response) => {
    const incoming = req.body || {};
    const current = getUiConfig();
    const merged = {
      version: current.version,
      appearance: { ...current.appearance, ...(incoming.appearance || {}) },
      layout: { ...current.layout, ...(incoming.layout || {}) },
      pages: { ...current.pages, ...(incoming.pages || {}) },
    };
    config.update({ uiConfig: merged } as any);
    res.json({ config: merged });
  });

  apiRouter.get('/ui/public', (_req: Request, res: Response) => {
    const cfg = getUiConfig();
    const { customCss: _, ...appearance } = cfg.appearance;
    res.json({ appearance });
  });

  apiRouter.post('/ui/background', requireAuth, (req: Request, res: Response) => {
    res.json({ config: getUiConfig() });
  });

  apiRouter.delete('/ui/background', requireAuth, (_req: Request, res: Response) => {
    res.json({ config: getUiConfig() });
  });

  // ===== 静态文件 + SPA Fallback =====
  const publicDir = WEBUI_PUBLIC_DIR;
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    // SPA fallback：非 /api 路由一律返回 index.html
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  return app;
}

/** 启动 WebUI 服务器 */
export function startWebServer(opts: WebUiOptions): void {
  const app = createWebServer(opts);
  const port = opts.port || opts.config.get<number>('webuiPort') || 4520;
  const host = opts.host || opts.config.get<string>('webuiHost') || '127.0.0.1';
  app.listen(port, host, () => {
    logger.info(`[WebUI] 管理界面已启动: http://${host}:${port}`);
  });
}
