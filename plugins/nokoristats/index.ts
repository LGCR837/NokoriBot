// Nokori 状态插件
// #Nokori → 运行时长 + 系统状态
// #Plugins → 已加载插件列表（不区分大小写）
import { PluginAPI, ParsedMessage } from '../../src/types';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const startTime = Date.now();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}days`);
  parts.push(`${hours}h`, `${minutes}min`, `${seconds}s`);
  return parts.join(' ');
}

function fmtMem(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return gb.toFixed(2) + 'GB';
  return (bytes / 1024 / 1024).toFixed(0) + 'MB';
}

function sampleCpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    idle += c.times.idle;
  }
  return { idle, total };
}

async function getCpuUsagePct(): Promise<number> {
  const a = sampleCpuTimes();
  await sleep(200);
  const b = sampleCpuTimes();
  const dt = b.total - a.total;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, ((dt - (b.idle - a.idle)) / dt) * 100));
}

/** 获取已加载插件列表 */
function getLoadedPlugins(pluginsDir: string): Array<{ name: string; version: string; description: string }> {
  const result: Array<{ name: string; version: string; description: string }> = [];
  if (!fs.existsSync(pluginsDir)) return result;
  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const manifestPath = path.join(pluginsDir, d.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.enabled === false) continue;
      result.push({
        name: manifest.name || d.name,
        version: manifest.version || '?',
        description: manifest.description || '',
      });
    } catch { /* skip broken manifests */ }
  }
  return result;
}

export function onLoad(api: PluginAPI) {
  // plugins 目录：直接用进程工作目录 + plugins
  const pluginsDir = path.join(process.cwd(), 'plugins');

  api.onMessage(async (msg: ParsedMessage) => {
    if (msg.fromSelf) return;
    const text = (msg.text || '').trim();

    // #nokori 状态查询
    if (/^#nokori$/i.test(text)) {
      api.consume(msg);
      const uptime = Date.now() - startTime;
      const cpuPct = await getCpuUsagePct();
      const cores = os.cpus().length;
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPct = totalMem ? (usedMem / totalMem) * 100 : 0;

      const lines = [
        'Nokori Bot v3',
        `Running: ${formatUptime(uptime)}`,
        `CPU: ${cpuPct.toFixed(1)}% (${cores} cores)`,
        `RAM: ${fmtMem(usedMem)} / ${fmtMem(totalMem)} (${memPct.toFixed(1)}%)`,
        `System: ${process.platform} ${os.arch()}`,
        'Powered by Aoharu Reverie',
      ];
      api.reply(msg, lines.join('\n'));
      api.log('info', `#nokori 状态查询 (uptime=${formatUptime(uptime)}, cpu=${cpuPct.toFixed(1)}%, ram=${memPct.toFixed(1)}%)`);
      return;
    }

    // #plugins 插件列表查询
    if (/^#plugins$/i.test(text)) {
      api.consume(msg);
      const plugins = getLoadedPlugins(pluginsDir);
      const lines = [`[Nokori Plugins]`, `已加载: ${plugins.length} 个插件`];
      for (const p of plugins) {
        lines.push(`${p.name} ${p.description}`);
      }
      api.reply(msg, lines.join('\n'));
      api.log('info', `#plugins 查询 (${plugins.length} 个插件)`);
      return;
    }
  });

  api.log('info', 'Nokori stats plugin loaded (#nokori #plugins)');
}
