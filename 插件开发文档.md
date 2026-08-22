# NokoriBot 插件开发文档

> 版本 3 | 适用于 NokoriBot v3+（OldChat v1.3.61+，含 NCUID 体系）
> **设计理念**：插件拥有完整的 Node.js 能力，无沙盒限制，开发自由

---

## 目录

1. [插件是什么](#1-插件是什么)
2. [快速开始](#2-快速开始)
3. [插件结构](#3-插件结构)
4. [清单文件 manifest.json](#4-清单文件-manifestjson)
5. [生命周期钩子](#5-生命周期钩子)
6. [插件 API 参考](#6-插件-api-参考)
7. [消息对象 ParsedMessage](#7-消息对象-parsedmessage)
8. [AT 提及格式](#8-at-提及格式)
9. [消息发送与 v2 自动升级](#9-消息发送与-v2-自动升级)
10. [无沙盒能力](#10-无沙盒能力)
11. [热加载机制](#11-热加载机制)
12. [示例插件合集](#12-示例插件合集)
13. [调试技巧](#13-调试技巧)
14. [最佳实践与安全](#14-最佳实践与安全)
15. [常见问题](#15-常见问题)

---

## 1. 插件是什么

插件是运行在 NokoriBot 框架中的独立模块，可以：

- 监听收到的消息（私聊 / 群聊）
- 注册并响应 `!命令`
- 发送文本、媒体消息，回复消息，@ 提及用户
- 查询用户资料、好友列表、群聊列表
- **不受沙盒限制**：可直接使用任何 npm 包（fs、数据库、axios、子进程等）

插件放在 `plugins/` 目录下，框架启动时自动加载（`manifest.json` 中 `enabled: true`），修改代码后**热加载即时生效**，无需重启。

## 2. 快速开始

在 `plugins/` 下新建目录 `hello`，创建两个文件：

**`plugins/hello/manifest.json`**

```json
{
  "name": "hello",
  "version": "1.0.0",
  "description": "我的第一个插件",
  "author": "你的名字",
  "enabled": true
}
```

**`plugins/hello/index.ts`**

```typescript
import { PluginAPI } from '../../src/types';

export function onLoad(api: PluginAPI) {
  // 注册命令：群/私聊里发 !ping 即回复
  api.registerCommand('ping', (args, msg) => {
    api.reply(msg, 'pong! 🏓');
  });

  // 监听所有消息
  api.onMessage((msg) => {
    if (msg.text.includes('你好') && !msg.fromSelf) {
      api.reply(msg, '你好呀！👋');
    }
  });

  api.log('info', 'Hello plugin loaded');
}
```

保存后，若框架正在运行，热加载会自动加载插件；控制台输出 `已加载插件: hello v1.0.0`。在群里发 `!ping`，Bot 回复 `pong! 🏓`。

## 3. 插件结构

每个插件是一个独立的目录，位于 `plugins/` 下：

```
plugins/
  my-plugin/
    manifest.json      # 插件清单（必填）
    index.ts           # 入口文件（默认 index.ts / index.js）
    config.json        # 可选：插件自身配置，通过 api.config 读取
    package.json       # 可选：插件私有依赖（需在插件目录内 npm install）
    README.md          # 可选
```

| 文件 | 必填 | 说明 |
|------|------|------|
| `manifest.json` | ✅ | 插件元数据与开关 |
| `index.ts` / `index.js` | ✅ | 入口，导出生命周期钩子 |
| `config.json` | ❌ | 插件自己的配置，自动读取到 `api.config` |
| `package.json` | ❌ | 插件私有的 npm 依赖 |

## 4. 清单文件 manifest.json

```json
{
  "name": "echo",
  "version": "1.0.0",
  "description": "回显插件，回复 !echo 内容",
  "author": "LGCR837",
  "enabled": true,
  "main": "index.ts"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | 必填 | 插件唯一标识，用于 API 与目录名 |
| `version` | string | `"0.0.0"` | 插件版本号 |
| `description` | string | `""` | 插件描述（WebUI 展示） |
| `author` | string | `""` | 作者 |
| `enabled` | boolean | `true` | 是否在启动时加载；WebUI 可切换 |
| `main` | string | `"index.ts"` | 入口文件，可为 `index.js` |

---

## 5. 生命周期钩子

入口文件导出一个或多个生命周期函数，框架在对应时机调用：

```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';

// 插件加载时调用（必须导出，否则插件无法加载）
export function onLoad(api: PluginAPI): void {
  // 初始化：注册命令、订阅消息、设置定时器等
}

// 收到消息时调用（所有消息，含私聊/群聊）
export function onMessage(msg: ParsedMessage, api: PluginAPI): void {
  // 处理消息
}

// 收到命令时调用（消息以 ! 开头，且为 !命令 形式）
export function onCommand(cmd: string, args: string[], msg: ParsedMessage, api: PluginAPI): void {
  // cmd: 命令名（不含 !），args: 空格拆分的参数数组
}

// 插件卸载或热重载前调用（清理定时器、关闭数据库等）
export function onUnload(): void {
  // 清理资源
}
```

**注意**：至少需要导出 `onLoad` 才能被加载。

### 钩子与订阅的等价关系

除了导出钩子函数，还可在 `onLoad` 内通过 `api.onMessage(...)` / `api.onCommand(...)` 订阅，二者都会收到分发：

```typescript
export function onLoad(api: PluginAPI) {
  // 等价于导出 onMessage 钩子
  api.onMessage((msg) => { /* ... */ });
  // 等价于导出 onCommand 钩子
  api.onCommand((cmd, args, msg) => { /* ... */ });
}
```

两种方式可混用，框架会同时触发。

---

## 6. 插件 API 参考

`onLoad` 收到的 `api`（`PluginAPI`）暴露以下能力：

### 消息发送

| 方法 | 说明 |
|------|------|
| `send(targetId, text, type?)` | 发送纯文本消息。`type`: `'direct'`（默认）/ `'group'`；自动适配 NCUID（`to_ncuid` / `to_uid`） |
| `sendMedia(targetId, mediaUrl, msgType, thumbUrl?, type?)` | 发送媒体消息。`msgType`: `'image'` / `'voice'` / `'video'` / `'resource'` |
| `reply(msg, text)` | 回复当前消息，自动判断会话类型（私聊回对方，群聊回本群） |

示例：

```typescript
// 发送文本
await api.send('USR-XXXXXX', '你好');                    // 私聊
await api.send('GRP-XXXXXX', '大家好啊', 'group');       // 群聊
// 发送图片
await api.sendMedia('GRP-XXXXXX', 'https://.../a.png', 'image', 'https://.../thumb.png', 'group');
// 回复
api.reply(msg, '收到你的消息了');
```

### 数据查询

| 方法 | 说明 |
|------|------|
| `getUserProfile(uid)` | 获取用户资料（缓存 4 小时）。`uid` 可为 ncuid 或旧 uid |
| `getFriends()` | 获取好友列表（缓存 5 分钟） |
| `getGroups()` | 获取群聊列表（缓存 5 分钟） |

```typescript
const profile = await api.getUserProfile(msg.from);
const name = profile?.display_name || profile?.username || msg.from;
```

### 官方 SDK 高级接口（api.sdk）

v3 起，`api.sdk` 直接暴露官方 `oldchat-api-sdk` 句柄，可使用框架未封装的全部业务能力
（动态、红包、签到墙、公审庭、表情广场、收藏、通知等 60+ 方法）：

| 成员 | 说明 |
|------|------|
| `sdk.OC` | 业务方法命名空间（完整列表见 SDK 目录下 `README.md` 第 10 节） |
| `sdk.OCError` | SDK 业务错误类，`e instanceof api.sdk.OCError` 判断（含 `code` / `raw`） |
| `sdk.apiFetch(url, init?)` | 裸传输层：请求任意 `/v1`、`/v2` 路径，自动签名/加密/降级，返回原始 `Response` |
| `sdk.resolveMediaUrl(url)` | 把相对媒体路径解析为绝对 URL |

```typescript
// 读取当前用户信息
const me = await api.sdk.OC.getMe();

// 获取私聊消息历史（返回后端原始结构）
const msgs = await api.sdk.OC.getDirectMessages(ncuid, { limit: 30, offset: 0 });

// 发布动态
await api.sdk.OC.postMoment({ body: 'Hello from NokoriBot v3' });

// 错误处理：区分业务错误与网络错误
try {
  await api.sdk.OC.doCheckin();
} catch (e) {
  if (e instanceof api.sdk.OCError) api.log('warn', `业务错误 code=${e.code}: ${e.message}`);
  else throw e;
}

// 裸传输层调用任意端点（url 必须以 /v1 或 /v2 开头）
const res = await api.sdk.apiFetch('/v1/friends');
const body = await res.json();
```

> 提示：`OC.*` 方法与框架的令牌/会话完全共享（同一登录态），401 自动刷新与重登由框架统一处理。

### 命令注册

| 方法 | 说明 |
|------|------|
| `registerCommand(name, handler)` | 注册命令，用户在会话中发 `!name 参数...` 即触发 |

```typescript
api.registerCommand('weather', async (args, msg) => {
  const city = args.join(' ') || 'Beijing';
  // ... 查询后回复
  api.reply(msg, `🌤 ${city} 天气`);
});
```

### 事件订阅

| 方法 | 说明 |
|------|------|
| `onMessage(handler)` | 订阅所有收到的消息（等价于 `onMessage` 钩子） |
| `onCommand(handler)` | 订阅 `!命令`（等价于 `onCommand` 钩子） |
| `on(event, listener)` | 监听框架事件（同 EventBus）：`connected` / `disconnected` / `ws_error` 等 |

### 其他

| 成员 | 说明 |
|------|------|
| `log(level, ...args)` | 输出日志，自动加插件名前缀。`level`: `debug` / `info` / `warn` / `error` |
| `config` | 插件自身配置（自动从插件目录 `config.json` 读取） |
| `version` | 框架版本号（`"3"`） |

---

## 7. 消息对象 ParsedMessage

`onMessage` / `onCommand` / `onMessage` 订阅收到的 `msg` 为统一解析后的消息对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 消息 ID |
| `from` | string | 发送者 ID（ncuid 优先，兼容旧 uid） |
| `fromName` | string | 发送者昵称 |
| `fromAvatar` | string | 发送者头像 |
| `fromSelf` | boolean | 是否为本人（Bot 自己）发送 |
| `text` | string | 消息正文（v2 已解包，AT 已封装为 token） |
| `rawBody` | string | 原始 body（可能是 v2 JSON 或纯文本） |
| `msgType` | string | `text` / `image` / `voice` / `video` / `resource` |
| `mediaUrl` | string \| null | 媒体地址（媒体消息） |
| `thumbUrl` | string \| null | 缩略图地址 |
| `type` | string | 会话类型：`direct`（私聊）/ `group`（群聊） |
| `groupId` | string \| undefined | 群聊 ID（群消息） |
| `target` | string | 目标对象（私聊对方 ID / 群 ID） |
| `createdAt` | number | 创建时间（秒级时间戳） |
| `mentions` | Mention[] | @提及列表（v2） |
| `quote` | Quote \| null | 引用消息（v2） |
| `ephemeral` | boolean \| undefined | 是否阅后即焚 |

常用判断：

```typescript
api.onMessage((msg) => {
  if (msg.fromSelf) return;                 // 忽略自己发的
  if (msg.type === 'group') {               // 群消息
    console.log(`群 ${msg.groupId} 收到 ${msg.fromName}: ${msg.text}`);
  }
  if (msg.msgType !== 'text') return;       // 只处理文本
});
```

---

## 8. AT 提及格式

框架将 AT 提及封装为特殊 token，插件按 ID 识别被提及者：

| 格式 | 含义 |
|------|------|
| `[ATNCUID:nc_xxx]` | 提及 NCUID 用户（`nc_` 前缀） |
| `[ATUID:12345]` | 提及旧 UID 用户 |

### 接收方向（消息 → 插件）

收到含提及的 v2 消息时，`msg.text` 中的 `@名字` 会被自动替换为 token：

```
收到文本: @Alice 早上好
msg.text: [ATNCUID:nc_abc123] 早上好
```

插件无需再查 `mentions` 数组即可知道被 @ 的是谁；`msg.mentions` 数组仍保留原始数据：

```typescript
api.onMessage((msg) => {
  if (msg.text.includes('[ATNCUID:') || msg.text.includes('[ATUID:')) {
    api.reply(msg, '有人在消息里 @ 了别人');
  }
});
```

### 发送方向（插件 → 消息）

插件在文本中直接写 token 即可提及用户，框架会自动：

1. 提取 token 生成 v2 `mentions` 数组
2. 查询被提及用户的昵称，把正文中的 `@id` 还原为 `@昵称`（查询失败回退为 `@id`）
3. 自动升级为 v2 消息体发送

```typescript
api.reply(msg, '开会了 [ATNCUID:nc_abc123] 请准时参加');
// 对方看到: 开会了 @爱丽丝 请准时参加（昵称高亮）
```

---

## 9. 消息发送与 v2 自动升级

框架发送文本时自动处理 v2 格式，**插件无需手动构造 JSON**：

| 文本内容 | 发送格式 |
|----------|----------|
| 纯文本（无换行/提及/引用） | 原样发送 |
| 含换行 | 自动升级为 `{"v":2,"text":"..."}` |
| 含 `[ATNCUID:xxx]` / `[ATUID:xxx]` | 升级为 v2 并生成 `mentions` 数组 |
| 含引用 | 升级为 v2 并携带 `quote` |

即：普通消息直接写字符串即可，框架自动决定是否需要 v2 封装。

---

## 10. 无沙盒能力

**这是 NokoriBot 插件系统的核心优势**：插件直接运行在 Node.js 进程中，无沙盒限制，可以自由使用任何 Node.js 模块。

### 可用的 Node.js 模块

```typescript
// 文件系统操作
import fs from 'fs';
import path from 'path';

// 数据库
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';

// HTTP 客户端
import axios from 'axios';

// 工具库
import _ from 'lodash';
import dayjs from 'dayjs';

// 子进程
import { exec, spawn } from 'child_process';
```

### 插件可以做的事情

- ✅ 读写本地文件（配置文件、数据文件、日志）
- ✅ 连接 SQLite / MySQL / PostgreSQL 等数据库
- ✅ 调用外部 REST API / WebSocket
- ✅ 执行系统命令（谨慎使用）
- ✅ 使用任何 npm 包
- ✅ 创建定时任务（`setInterval`、`node-cron`）
- ✅ 启动子进程
- ✅ 使用 WebSocket 客户端连接其他服务

### 安全提示

由于插件拥有完整 Node.js 能力，**请确保只安装可信的插件**。框架本身不限制插件行为，信任由使用者自行管理。

---

## 11. 热加载机制

- 框架使用 `chokidar` 监控插件目录（`plugins/`）的文件变化
- 当任何 `*.ts` / `*.js` / `manifest.json` 文件被修改时：
  1. 调用该插件的 `onUnload`（若存在）
  2. 清除 `require.cache` 中该模块的引用
  3. 重新加载入口文件
  4. 调用新模块的 `onLoad`
- 若新模块抛出异常，则**保留旧插件**并记录错误，不影响 Bot 运行
- 在 `plugins/` 下新建目录并放入 `manifest.json` + 入口文件，会自动加载新插件
- 删除插件入口文件，会自动卸载该插件

> 注意：`onUnload` 中请清理定时器、关闭数据库等资源，避免热重载后产生重复实例。

---

## 12. 示例插件合集

### 12.1 回显插件（echo）

**`plugins/echo/manifest.json`**

```json
{
  "name": "echo",
  "version": "1.0.0",
  "description": "回显插件：nokori test <内容> 原样回复",
  "author": "LGCR837",
  "enabled": true
}
```

**`plugins/echo/index.ts`**

```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';

export function onLoad(api: PluginAPI) {
  // 前缀触发：nokori test <内容> → 回显内容
  api.onMessage((msg: ParsedMessage) => {
    if (msg.fromSelf) return;
    const text = (msg.text || '').trim();
    const match = text.match(/^nokori\s+test\s+(.+)$/i);
    if (match) {
      const replyText = match[1].trim();
      api.log('info', `收到测试指令，回显: ${replyText}`);
      api.reply(msg, replyText || '用法: nokori test <message>');
    }
  });

  // 命令触发：!echo <内容> → 回显内容
  api.registerCommand('echo', (args: string[], msg: ParsedMessage) => {
    const text = args.join(' ');
    api.reply(msg, text ? text : '用法: !echo <message>');
  });

  api.log('info', 'Echo plugin loaded');
}

export function onUnload() {
  console.log('Echo plugin unloaded');
}
```

### 12.2 使用数据库（SQLite）

**`plugins/db-plugin/manifest.json`**

```json
{
  "name": "db-plugin",
  "version": "1.0.0",
  "description": "笔记存储插件（better-sqlite3）",
  "author": "LGCR837",
  "enabled": true
}
```

**`plugins/db-plugin/index.ts`**

```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';
import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function onLoad(api: PluginAPI) {
  // 初始化数据库（插件目录下的 data.db）
  const dbPath = path.join(__dirname, 'data.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  api.registerCommand('note', (args: string[], msg: ParsedMessage) => {
    const action = args[0];
    const content = args.slice(1).join(' ');

    if (action === 'save' && content) {
      db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)').run(msg.from, content);
      api.reply(msg, '✅ 笔记已保存');
    } else if (action === 'list') {
      const rows: any[] = db
        .prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
        .all(msg.from);
      if (rows.length === 0) {
        api.reply(msg, '📭 暂无笔记');
      } else {
        const list = rows.map((r) => `• ${r.content} (${r.created_at})`).join('\n');
        api.reply(msg, `📝 你的笔记：\n${list}`);
      }
    } else {
      api.reply(msg, '用法: !note save <内容> 或 !note list');
    }
  });

  api.log('info', 'Database plugin loaded');
}

export function onUnload() {
  if (db) db.close();
}
```

> 提示：插件使用 npm 依赖时，在插件目录内执行 `npm install <包名>` 安装即可。

### 12.3 调用外部 API

**`plugins/weather/index.ts`**

```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';
import axios from 'axios';

export function onLoad(api: PluginAPI) {
  api.registerCommand('weather', async (args: string[], msg: ParsedMessage) => {
    const city = args.join(' ') || 'Beijing';
    try {
      const resp = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: { q: city, appid: 'your_api_key', units: 'metric', lang: 'zh_cn' },
      });
      const data = resp.data;
      api.reply(
        msg,
        `🌤 ${data.name} 天气\n` +
          `温度: ${data.main.temp}°C\n` +
          `天气: ${data.weather[0].description}\n` +
          `湿度: ${data.main.humidity}%`
      );
    } catch (error: any) {
      api.reply(msg, `❌ 查询失败: ${error.message}`);
    }
  });
  api.log('info', 'Weather plugin loaded');
}
```

### 12.4 定时任务 + 主动发消息

```typescript
import { PluginAPI } from '../../src/types';

let timer: NodeJS.Timeout | null = null;

export function onLoad(api: PluginAPI) {
  // 每天早上 9 点向指定群发问候
  timer = setInterval(() => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      api.send('GRP-XXXXXX', '早上好！☀️', 'group');
    }
  }, 60 * 1000);

  api.log('info', 'Cron plugin loaded');
}

export function onUnload() {
  if (timer) clearInterval(timer); // 必须清理，避免热重载后重复触发
}
```

### 12.5 使用插件自身配置

**`plugins/myconfig/config.json`**

```json
{
  "greeting": "你好呀",
  "autoReply": true
}
```

**`plugins/myconfig/index.ts`**

```typescript
import { PluginAPI } from '../../src/types';

export function onLoad(api: PluginAPI) {
  // api.config 自动从插件目录 config.json 读取
  const greeting: string = api.config.greeting || '你好';
  const autoReply: boolean = api.config.autoReply !== false;

  api.onMessage((msg) => {
    if (autoReply && !msg.fromSelf) {
      api.reply(msg, `${greeting}！`);
    }
  });
}
```

---

## 13. 调试技巧

- **开启 debug 日志**：在 WebUI 的配置页面把日志级别改为 `debug`（或直接改 `config.json` 的 `logLevel`），即可看到框架打印的收到消息日志：
  ```
  [Bot] 收到消息 [group] from=USR-XXXX (昵称) self=false: 消息内容
  ```
- **插件内输出日志**：`api.log('debug', ...)` / `api.log('info', ...)`，自动带插件名前缀；也可直接用 `console.log`。
- **热重载调试**：修改插件代码保存后自动重载，控制台会输出 `热重载...`，无需重启 Bot。
- **Node 调试器**：`node --inspect dist/index.js`，然后用 Chrome DevTools 连接（或 `npm run dev` 配合 IDE 调试）。
- **WebUI 日志页**：`http://127.0.0.1:4520` 的"日志查看"标签页实时滚动显示日志。
- **快速验证逻辑**：可写独立测试脚本用 `npx tsx 脚本.ts` 运行，模拟消息对象调用插件函数（见 12 节示例风格）。

---

## 14. 最佳实践与安全

### 最佳实践

1. **忽略自己的消息**：`onMessage` 里先判断 `msg.fromSelf`，避免 Bot 对自己发送的消息产生循环回复。
2. **命令参数解析**：`!命令` 后按空格拆分参数；含空格的内容用 `args.slice(1).join(' ')` 还原。
3. **善用缓存**：`getUserProfile` / `getFriends` / `getGroups` 框架自带缓存，无需自行加缓存。
4. **异常处理**：异步操作（外部 API、数据库）务必 try/catch，回复错误信息而不是让插件崩溃。
5. **清理资源**：`onUnload` 中清理定时器、关闭数据库连接、移除事件监听。
6. **配置外置**：需要经常修改的值放插件自己的 `config.json`，避免改代码。
7. **消息频率**：避免对每条消息都做高开销操作；群聊场景注意触发词避免刷屏。

### 安全提示

- 插件拥有**完整 Node.js 权限**（fs、子进程、网络），请只安装/信任来源可靠的插件。
- 插件可以执行系统命令、读写任意文件——第三方插件等同于在本机运行任意代码。
- 不要把敏感信息（数据库密码、API Key）硬编码在插件中；如需使用，放在 `config.json` 并注意该目录的访问权限。

---

## 15. 常见问题

**Q：插件加载失败提示 `api.onMessage is not a function`？**  
A：框架版本过旧。升级到 v2.0.0 后 `PluginAPI` 已提供 `onMessage` / `onCommand` 订阅方法。

**Q：为什么我发消息 Bot 没反应？**  
A：先确认插件已加载（日志 `已加载插件: xxx`），再把日志级别调成 `debug` 查看 `[Bot] 收到消息`。若完全没有该日志，说明消息未推送到 WS；若显示 `self=true`，说明你用的是 Bot 自己的账号，框架会忽略自己发送的消息（换一个账号测试）。

**Q：热加载不生效？**  
A：检查文件是否在 `plugins/` 内，且扩展名为 `.ts` 或 `.js`。TypeScript 需在框架以 `tsx`（`npm run dev`）或 ts-node 运行时才支持；生产构建 `node dist/index.js` 下请使用 `.js` 插件。

**Q：`!命令` 不触发？**  
A：命令必须以 `!` 开头（如 `!ping`），且与命令名之间不能有空格；参数间用空格分隔。想用自然语言前缀（如 `nokori test xxx`）请在 `onMessage` 里自己做正则匹配。

**Q：如何在插件里 @ 别人？**  
A：在文本中写 `[ATNCUID:nc_xxx]` 或 `[ATUID:xxx]`，框架自动生成 v2 mentions 并显示为 `@昵称`。

**Q：如何获取自己的 NCUID？**  
A：登录后 `BotClient.myUid` 自动设置为 `user.ncuid`（优先）或 `user.uid`。插件中可通过事件获取，或查看日志 `当前用户: 昵称 (ncuid=USR-...)`。

**Q：插件可以使用哪些 Node.js 模块？**  
A：任何 npm 包都可以，无沙盒限制，完全自由。

**Q：热重载后插件状态丢失？**  
A：模块级变量（如 `let db`）在重载后会重置；需要持久化的数据请存数据库或文件。`onUnload` 中请释放资源。

---

Happy Boting! 🚀


