// Nokori 状态插件
// 记录插件启动时间，收到全字匹配的 #nokori / #Nokori 时输出运行时长 + 系统状态。
// 输出格式：
//   Nokori Bot
//   Running: 1days 2h 3min 4s
//   CPU: 23.4% (8 cores)
//   RAM: 3.2GB / 16.0GB (20.0%)
//   System: win32 x64
//   Powered by Aoharu Reverie
// （days=0 时不显示 days；CPU 通过两次采样差值计算，Windows/Linux 通用）
import { PluginAPI, ParsedMessage } from '../../src/types';
import * as os from 'os';

/** 启动时间戳（插件加载即记录） */
const startTime = Date.now();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 格式化运行时长：1days 2h 3min 4s（days=0 省略 days） */
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

/** 格式化内存体积（自动 GB/MB） */
function fmtMem(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return gb.toFixed(2) + 'GB';
  return (bytes / 1024 / 1024).toFixed(0) + 'MB';
}

/** 采样当前 CPU 累计 idle/total 时间（os.cpus()，跨平台） */
function sampleCpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    idle += c.times.idle;
  }
  return { idle, total };
}

/** 计算整体 CPU 使用率（两次采样差值，Windows 同样有效） */
async function getCpuUsagePct(): Promise<number> {
  const a = sampleCpuTimes();
  await sleep(200);
  const b = sampleCpuTimes();
  const dt = b.total - a.total;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, ((dt - (b.idle - a.idle)) / dt) * 100));
}

export function onLoad(api: PluginAPI) {
  api.onMessage(async (msg: ParsedMessage) => {
    if (msg.fromSelf) return;
    const text = (msg.text || '').trim();
    // 全字匹配 #nokori / #Nokori（大小写不敏感）
    if (!/^#nokori$/i.test(text)) return;

    api.consume(msg); // 声明已处理，避免触发 ChatLLM 兜底

    const uptime = Date.now() - startTime;

    // 系统状态（跨平台）
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
  });

  api.log('info', 'Nokori status plugin loaded (#nokori)');
}
