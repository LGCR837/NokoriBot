// ===== PluginManager：插件管理器 =====
// - 加载/卸载/热重载插件（require + require.cache，无沙盒）
// - chokidar 监控插件目录，修改 *.ts/*.js 即时热加载
// - 支持 manifest.json 元数据与插件自身 config.json
import fs from 'fs';
import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import { logger } from '../logger';
import { PluginInfo, PluginModule, ParsedMessage } from '../types';
import { PluginAPI } from './api';
import { BotClient } from '../protocol/bot';

interface LoadedPlugin {
  info: PluginInfo;
  module: PluginModule;
  api: PluginAPI;
  configPath: string;
}

export class PluginManager {
  private pluginsDir: string;
  private apiFactory: () => PluginAPI;
  private bot: BotClient;
  private plugins = new Map<string, LoadedPlugin>();
  private watcher: FSWatcher | null = null;

  constructor(pluginsDir: string, apiFactory: () => PluginAPI, bot: BotClient) {
    this.pluginsDir = pluginsDir;
    this.apiFactory = apiFactory;
    this.bot = bot;
  }

  /** 加载全部插件（按 manifest.enabled 过滤） */
  async loadAll(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) {
      logger.warn(`[Plugins] 插件目录不存在: ${this.pluginsDir}`);
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return;
    }
    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('.')) continue;
      try {
        await this.loadPlugin(name);
      } catch (e: any) {
        logger.error(`[Plugins] 加载插件 ${name} 失败: ${e.message}`);
      }
    }
    this.startWatcher();
  }

  /** 加载单个插件 */
  async loadPlugin(name: string): Promise<void> {
    const dir = path.join(this.pluginsDir, name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      logger.debug(`[Plugins] ${name} 缺少 manifest.json，跳过`);
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // 尊重 manifest.enabled=false：停用的插件不加载（否则事件订阅照常生效，等于没停用）
    if (manifest.enabled === false) {
      logger.debug(`[Plugins] ${name} 已在 manifest 中停用，跳过加载`);
      return;
    }
    const main = manifest.main || 'index.ts';
    const entryPath = path.join(dir, main);
    if (!fs.existsSync(entryPath)) {
      // 兼容 index.js 默认入口
      const jsPath = path.join(dir, 'index.js');
      const tsPath = path.join(dir, 'index.ts');
      if (fs.existsSync(jsPath)) {
        this.loadEntry(dir, jsPath, manifest, name);
        return;
      }
      if (fs.existsSync(tsPath)) {
        this.loadEntry(dir, tsPath, manifest, name);
        return;
      }
      throw new Error(`入口文件不存在: ${main}`);
    }
    this.loadEntry(dir, entryPath, manifest, name);
  }

  /** 实际加载入口模块 */
  private loadEntry(dir: string, entryPath: string, manifest: any, name: string): void {
    const api = this.apiFactory();
    const configPath = path.join(dir, 'config.json');
    let pluginConfig = {};
    if (fs.existsSync(configPath)) {
      pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    api.bind(name, pluginConfig);

    // 清除模块缓存，保证热加载读取最新代码
    const resolved = require.resolve(entryPath);
    delete require.cache[resolved];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: PluginModule = require(entryPath);
    if (typeof mod.onLoad !== 'function') {
      throw new Error('插件入口必须导出 onLoad 函数');
    }
    mod.onLoad(api);

    const info: PluginInfo = {
      name,
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      author: manifest.author || '',
      enabled: manifest.enabled !== false,
      hasConfig: fs.existsSync(configPath),
      main: manifest.main || 'index.ts',
      loaded: true,
      dir,
    };
    this.plugins.set(name, { info, module: mod, api, configPath });
    logger.info(`[Plugins] 已加载插件: ${name} v${info.version}`);
  }

  /** 卸载单个插件 */
  async unloadPlugin(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) return;
    try {
      if (typeof loaded.module.onUnload === 'function') {
        loaded.module.onUnload();
      }
    } catch (e: any) {
      logger.error(`[Plugins] 插件 ${name} onUnload 异常: ${e.message}`);
    }
    // 移除插件通过 api.on() 注册的事件监听器，避免热重载/重启后重复触发
    loaded.api.dispose();
    this.plugins.delete(name);
    logger.info(`[Plugins] 已卸载插件: ${name}`);
  }

  /** 热重载单个插件 */
  async reloadPlugin(name: string): Promise<void> {
    await this.unloadPlugin(name);
    await this.loadPlugin(name);
  }

  /** 获取所有插件信息（已加载 + 未加载/已停用的插件目录，供 WebUI 完整展示） */
  getAllPlugins(): PluginInfo[] {
    const result: PluginInfo[] = Array.from(this.plugins.values()).map((p) => ({
      ...p.info,
      loaded: true,
    }));
    // 扫描插件目录，补上未加载的插件（manifest.enabled=false 停用 或 加载失败）
    if (fs.existsSync(this.pluginsDir)) {
      const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const name = entry.name;
        if (this.plugins.has(name)) continue;
        const manifestPath = path.join(this.pluginsDir, name, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          const pluginDir = path.join(this.pluginsDir, name);
          result.push({
            name,
            version: manifest.version || '0.0.0',
            description: manifest.description || '',
            author: manifest.author || '',
            enabled: manifest.enabled !== false,
            hasConfig: fs.existsSync(path.join(pluginDir, 'config.json')),
            main: manifest.main || 'index.ts',
            loaded: false,
            dir: pluginDir,
          });
        } catch (e: any) {
          logger.warn(`[Plugins] 读取 ${name} manifest 失败: ${e.message}`);
        }
      }
    }
    return result;
  }

  /** 切换插件启用状态（停用/未加载的插件也可切换，仅持久化 manifest） */
  async togglePlugin(name: string): Promise<boolean> {
    const dir = path.join(this.pluginsDir, name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`插件 ${name} 不存在`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.enabled = manifest.enabled === false;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    // 若已加载则同步内存中的 enabled 状态
    const loaded = this.plugins.get(name);
    if (loaded) loaded.info.enabled = manifest.enabled;
    logger.info(`[Plugins] ${name} 已${manifest.enabled ? '启用' : '停用'}`);
    return manifest.enabled;
  }

  /** 卸载所有插件 */
  async unloadAll(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    const names = Array.from(this.plugins.keys());
    for (const name of names) {
      await this.unloadPlugin(name);
    }
  }

  /** 读取插件配置（config.json），不存在时返回空对象 */
  getPluginConfig(name: string): Record<string, any> {
    const loaded = this.plugins.get(name);
    if (!loaded) return {};
    try {
      if (fs.existsSync(loaded.configPath)) {
        return JSON.parse(fs.readFileSync(loaded.configPath, 'utf8'));
      }
    } catch (e: any) {
      logger.warn(`[Plugins] 读取 ${name} config 失败: ${e.message}`);
    }
    return {};
  }

  /** 保存插件配置到 config.json，并同步到已加载插件的 api.config */
  savePluginConfig(name: string, config: Record<string, any>): void {
    const loaded = this.plugins.get(name);
    if (!loaded) throw new Error(`插件 ${name} 未加载`);
    try {
      fs.writeFileSync(loaded.configPath, JSON.stringify(config, null, 2), 'utf8');
      loaded.api.config = config || {};
      logger.info(`[Plugins] 已保存 ${name} 的 config.json`);
    } catch (e: any) {
      throw new Error(`保存 ${name} 配置失败: ${e.message}`);
    }
  }

  /** 分发消息给所有已加载插件 */
  dispatchMessage(msg: ParsedMessage): void {
    for (const loaded of this.plugins.values()) {
      if (!loaded.info.enabled) continue;
      try {
        if (typeof loaded.module.onMessage === 'function') {
          loaded.module.onMessage(msg, loaded.api);
        }
      } catch (e: any) {
        logger.error(`[Plugins] ${loaded.info.name} onMessage 异常: ${e.message}`);
      }
      // 同时触发插件内 api.onMessage(...) 订阅的回调
      loaded.api.dispatchMessage(msg);
    }
  }

  /** 分发命令给所有已加载插件 */
  dispatchCommand(cmd: string, args: string[], msg: ParsedMessage): void {
    for (const loaded of this.plugins.values()) {
      if (!loaded.info.enabled) continue;
      try {
        if (typeof loaded.module.onCommand === 'function') {
          loaded.module.onCommand(cmd, args, msg, loaded.api);
        }
      } catch (e: any) {
        logger.error(`[Plugins] ${loaded.info.name} onCommand 异常: ${e.message}`);
      }
      // 同时触发插件内 api.onCommand(...) 订阅的回调
      loaded.api.dispatchCommand(cmd, args, msg);
    }
  }

  /** 启动文件监控：*.ts / *.js 变化即热重载 */
  private startWatcher(): void {
    if (this.watcher) return;
    const watchPatterns = [
      path.join(this.pluginsDir, '**', '*.ts'),
      path.join(this.pluginsDir, '**', '*.js'),
      path.join(this.pluginsDir, '**', 'manifest.json'),
    ];
    this.watcher = chokidar.watch(watchPatterns, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('change', (filePath: string) => {
      this.handleFileChange(filePath);
    });
    this.watcher.on('add', (filePath: string) => {
      this.handleFileChange(filePath, true);
    });
    this.watcher.on('unlink', (filePath: string) => {
      const rel = path.relative(this.pluginsDir, filePath);
      const name = rel.split(path.sep)[0];
      if (name && /\.(ts|js)$/.test(filePath)) {
        logger.info(`[Plugins] ${name} 入口被删除，卸载插件`);
        this.unloadPlugin(name).catch(() => {});
      }
    });

    logger.info('[Plugins] 文件监控已启动（修改插件代码即时生效）');
  }

  /** 处理插件文件变更 */
  private handleFileChange(filePath: string, isNew = false): void {
    const rel = path.relative(this.pluginsDir, filePath);
    const name = rel.split(path.sep)[0];
    if (!name) return;

    if (filePath.endsWith('manifest.json')) {
      // manifest 变更：更新元数据
      try {
        const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const loaded = this.plugins.get(name);
        if (loaded) {
          loaded.info.version = manifest.version || loaded.info.version;
          loaded.info.description = manifest.description || loaded.info.description;
          loaded.info.author = manifest.author || loaded.info.author;
          loaded.info.enabled = manifest.enabled !== false;
          logger.info(`[Plugins] ${name} manifest 已更新`);
        }
        return;
      } catch (e: any) {
        logger.error(`[Plugins] ${name} manifest 解析失败: ${e.message}`);
        return;
      }
    }

    if (!/\.(ts|js)$/.test(filePath)) return;
    if (isNew) {
      // 新文件：尝试加载新插件
      this.loadPlugin(name)
        .then(() => logger.info(`[Plugins] 新插件已加载: ${name}`))
        .catch((e) => logger.warn(`[Plugins] 加载新插件 ${name} 失败: ${e.message}`));
      return;
    }

    logger.info(`[Plugins] ${name} 代码变更，热重载...`);
    this.reloadPlugin(name).catch((e: any) => {
      // 热重载失败时保留旧插件
      logger.error(`[Plugins] ${name} 热重载失败（保留旧版本）: ${e.message}`);
    });
  }
}
