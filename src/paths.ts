// ===== 路径解析：鲁棒地定位项目根目录 =====
// 兼容两种运行方式：
// - tsx 开发模式：__dirname 指向 src/，上溯一层即项目根
// - 编译产物 dist/：__dirname 指向 dist/，上溯一层即项目根
// 通过向上查找 package.json 确定项目根，避免路径写死导致配置/插件/日志落到错误目录
import fs from 'fs';
import path from 'path';

export function findProjectRoot(startDir?: string): string {
  let dir = startDir || __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();
export const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
export const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
export const PLUGINS_DIR = path.join(PROJECT_ROOT, 'plugins');
export const WEBUI_PUBLIC_DIR = path.join(PROJECT_ROOT, 'webui', 'public');
