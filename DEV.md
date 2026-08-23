# NokoriBot 框架完整开发文档

> 版本 3 | 适用于 OldChat v1.3.61+
> 核心协议层基于官方 `oldchat-api-sdk-javascript` SDK 实现（宿主适配见 src/protocol/sdk.ts）  
> **设计理念**：插件拥有完整的 Node.js 能力，无沙盒限制，开发自由

---

## 目录

1. [项目简介](#1-项目简介)
2. [技术选型](#2-技术选型)
3. [系统架构](#3-系统架构)
4. [快速开始](#4-快速开始)
5. [核心模块详解](#5-核心模块详解)
   - 5.1 配置管理
   - 5.2 加密与协议
   - 5.3 HTTP 客户端
   - 5.4 WebSocket 客户端
   - 5.5 消息解析器
   - 5.6 事件总线
   - 5.7 Bot 核心客户端
6. [WebUI 管理](#6-webui-管理)
   - 6.1 服务器与端口
   - 6.2 前端界面
   - 6.3 REST API
   - 6.4 配置持久化
   - 6.5 登录与自动重登录
7. [插件系统](#7-插件系统)
   - 7.1 插件结构
   - 7.2 清单文件
   - 7.3 生命周期钩子
   - 7.4 插件 API
   - 7.5 插件能力（无沙盒，完整 Node.js）
   - 7.6 热加载机制
8. [插件开发指南](#8-插件开发指南)
   - 8.1 创建插件
   - 8.2 示例插件
   - 8.3 使用数据库
   - 8.4 调用外部 API
   - 8.5 调试技巧
9. [部署与运维](#9-部署与运维)
   - 9.1 生产构建
   - 9.2 使用 PM2 守护
10. [API 参考](#10-api-参考)
11. [常见问题](#11-常见问题)
12. [附录：从 app.js 迁移](#12-附录从-appjs-迁移)

---

## 1. 项目简介

**NokoriBot** 是一个基于 Node.js + TypeScript 的聊天机器人开发框架，专为 OldChat 社交平台设计。它完整实现了 OldChat 的 ECDH 加密握手、WebSocket 消息收发、NCUID 兼容层以及 v2 消息格式，并提供 **热加载插件系统** 和 **WebUI 管理界面**。

### 核心特性
- ✅ API 层全面切换至官方 `oldchat-api-sdk`（v1↔v2 映射、ECDH 签名 + AES 信封、候选后端降级、端点熔断均由 SDK 承担）
- ✅ 原生支持 NCUID（`nc_` 前缀）与旧 UID 自动适配
- ✅ WebSocket 长连接，自动重连，心跳保活
- ✅ 消息自动解密、解析（v2 JSON、引用、@提及、阅后即焚）
- ✅ **插件无沙盒限制，拥有完整 Node.js 能力（可自由使用 fs、数据库、HTTP 客户端等）**
- ✅ 插件热加载（修改即时生效，无需重启）
- ✅ WebUI 管理界面（端口 4520，无需账密）
- ✅ 配置可视化编辑，持久化存储
- ✅ 账号密码登录，自动处理 Token 刷新与重登录

### 命名由来
**Nokori** - **残り**

---

## 2. 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 运行时 | Node.js 18+ | 事件驱动，适合长连接；内置 `crypto.webcrypto` 兼容浏览器 SubtleCrypto |
| 语言 | TypeScript | 类型安全，便于维护大型框架 |
| HTTP 客户端 | 全局 fetch（Node 18+） | 零依赖；所有请求经官方 SDK 的 ocTransport 转接器发出 |
| API 层 | oldchat-api-sdk-javascript（官方 SDK） | v1↔v2 映射、ECDH 签名 + AES 信封、候选后端降级、端点熔断均由 SDK 承担 |
| WebSocket | ws | 高性能，稳定，广泛使用 |
| Web 框架 | Express | 轻量、灵活，易与 Node 集成 |
| 插件加载 | `require` + `require.cache` | 原生支持，简单可靠，无沙盒开销 |
| 日志 | winston | 结构化日志，彩色输出，文件轮转 |
| 配置管理 | `config.json` | 单一配置文件，简单明了 |
| 文件监控 | chokidar | 高效监听插件目录变化 |

---

## 3. 系统架构

```
┌────────────────────────────────────────────────────────────────┐
│                   主进程 (index.ts)                           │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              BotClient (核心客户端)                      │ │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │ │
│  │  │ ApiClient  │  │ WsClient   │  │ PluginManager    │  │ │
│  │  │ (HTTP)     │  │ (WS+加密)  │  │ (热加载/管理)    │  │ │
│  │  └────────────┘  └────────────┘  └──────────────────┘  │ │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │ │
│  │  │ Message    │  │ EventBus   │  │ ConfigManager    │  │ │
│  │  │ Parser     │  │ (Emitter)  │  │ (读写配置)       │  │ │
│  │  └────────────┘  └────────────┘  └──────────────────┘  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                           ▲                                  │
│                           │ 事件 / API                      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │          WebUI 服务器 (端口 4520)                        │ │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │ │
│  │  │ Express    │  │ 静态文件   │  │ REST API 路由    │  │ │
│  │  │ 服务器     │  │ (HTML/CSS) │  │ /api/plugins     │  │ │
│  │  └────────────┘  └────────────┘  └──────────────────┘  │ │
│  └──────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│                     插件 (直接 require)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Plugin A │  │ Plugin B │  │ Plugin C │                   │
│  │ (echo)   │  │ (db)     │  │ (api)    │                   │
│  │          │  │ fs/MySQL │  │ axios    │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
└────────────────────────────────────────────────────────────────┘
```

- **BotClient**：协调所有模块，暴露统一的 API，处理登录、消息分发、插件生命周期。
- **ApiClient**：HTTP 请求封装，自动管理 Token 和刷新。
- **WsClient**：WebSocket 连接管理，加密握手，心跳保活。
- **MessageParser**：解析消息体（v2 JSON、引用、@提及、阅后即焚）。
- **PluginManager**：加载/卸载/热重载插件。
- **ConfigManager**：读取和写入 `config.json`，通知配置变更。
- **WebUI 服务器**：提供管理界面，通过 REST API 与 Bot 核心交互。

---

## 4. 快速开始

### 4.1 安装
```bash
git clone https://github.com/LGCR837/NokoriBot.git
cd nokoribot
npm install
```

### 4.2 配置
创建 `config.json`（位于项目根目录）：
```json
{
  "backendOrigin": "http://oc.mcl0.dpdns.org",
  "mediaOrigin": "http://60.205.94.101:8080",
  "username": "your_username",
  "password": "your_password",
  "pluginsDir": "./plugins",
  "logLevel": "info",
  "webuiPort": 4520,
  "devMode": true
}
```
- `username` 和 `password` 用于 Bot 登录，首次启动时自动获取 token。
- `devMode: true` 时启用更详细的日志和错误堆栈。
- 所有配置仅通过此文件管理，无需环境变量。

### 4.3 启动
```bash
npm run dev      # 开发模式（ts-node）
# 或
npm run build && npm start   # 生产模式
```

### 4.4 访问 WebUI
浏览器打开 `http://127.0.0.1:4520`，即可看到管理界面。

### 4.5 第一个插件
在 `plugins/echo/` 下创建 `manifest.json` 和 `index.ts`，编写代码（见 [8.2 示例插件](#82-示例插件)）。保存后插件自动加载，无需重启。

---

## 5. 核心模块详解

### 5.1 配置管理

**文件**：`src/config-manager.ts`  
**职责**：加载 `config.json`，提供类型安全的配置对象，并监听配置变更。

```typescript
interface Config {
  backendOrigin: string;
  mediaOrigin: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  pluginsDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  webuiPort: number;
  wsHeartbeatInterval?: number;   // 秒，默认 30
  wsReconnectDelay?: number;      // 秒，默认 3
  devMode?: boolean;              // 开发者模式
}
```

**核心方法**：
- `load()`：读取配置文件，若不存在则创建默认。
- `save(updates: Partial<Config>)`：合并更新并写入文件，触发 `onUpdate` 事件。
- `get<T>(key: keyof Config): T`：获取配置项。
- `onUpdate(callback: (newConfig: Config) => void)`：注册变更监听。

### 5.2 加密与协议

**文件**：`src/protocol/crypto.ts`  
**职责**：实现 ECDH 密钥协商、AES-CBC 加解密、HMAC 验证、Base64 编解码等。

> 代码直接移植自 `app.js` 的 `Crypto` 对象，仅将 `window.crypto` 替换为 `globalThis.crypto`（Node.js 内置）。

#### 5.2.1 `Crypto` 工具对象

| 方法 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| `sha256(data: Uint8Array)` | SHA-256 哈希 | `data` | `Promise<Uint8Array>` |
| `hmacSha256(key: Uint8Array, data: Uint8Array)` | HMAC-SHA256 | `key`, `data` | `Promise<Uint8Array>` |
| `base64ToBytes(str: string)` | Base64 转 Uint8Array | `str` | `Uint8Array` |
| `bytesToBase64(bytes: Uint8Array)` | Uint8Array 转 Base64 | `bytes` | `string` |
| `concatBytes(a: Uint8Array, b: Uint8Array)` | 拼接两个字节数组 | `a`, `b` | `Uint8Array` |
| `timingSafeEqual(a: Uint8Array, b: Uint8Array)` | 常量时间比较 | `a`, `b` | `boolean` |
| `pkcs7Unpad(data: Uint8Array)` | 去除 PKCS#7 填充 | `data` | `Uint8Array` |

#### 5.2.2 ECDH 握手（`ensureWsSession`）

```typescript
async function ensureWsSession(apiClient: ApiClient): Promise<WsSession>
```
- 生成 P-256 密钥对，调用 `/v1/auth/handshake` 交换公钥，派生 `encKey` 和 `macKey`。
- 返回 `{ sessionId: string, encKey: Uint8Array, macKey: Uint8Array }`。
- 异常时抛出错误。

#### 5.2.3 解密信封（`decryptEnvelope`）

```typescript
async function decryptEnvelope(payload: string, session: WsSession): Promise<string | null>
```
- 解密 WebSocket 收到的加密 JSON 信封（格式 `{iv, data, mac}`），验证 MAC，AES-CBC 解密，去填充，返回明文 JSON 字符串。
- MAC 不匹配或解密失败时返回 `null`。

### 5.3 HTTP 客户端

**文件**：`src/api-client.ts`  
**职责**：封装所有 HTTP 请求，自动携带 Token，处理 401 刷新与密码重登录。

#### 5.3.1 初始化
```typescript
const api = new ApiClient({
  baseURL: config.backendOrigin + '/v1',
  accessToken: config.accessToken,
  refreshToken: config.refreshToken,
  username: config.username,
  password: config.password,
  onTokenUpdate: (newToken, newRefresh) => { /* 更新 config */ }
});
```

#### 5.3.2 核心方法

| 方法 | 说明 | 参数 | 返回值 |
|------|------|------|--------|
| `get<T>(path: string, params?: object)` | GET 请求 | `path`, `params` | `Promise<T>` |
| `post<T>(path: string, data?: object)` | POST 请求 | `path`, `data` | `Promise<T>` |
| `put<T>(path: string, data?: object)` | PUT 请求 | `path`, `data` | `Promise<T>` |
| `delete<T>(path: string)` | DELETE 请求 | `path` | `Promise<T>` |
| `upload<T>(path: string, formData: FormData)` | 文件上传（multipart） | `path`, `formData` | `Promise<T>` |
| `login(username: string, password: string)` | 主动登录，获取 token | `username`, `password` | `Promise<void>` |

#### 5.3.3 Token 与自动重登录机制
- 每次请求自动添加 `Authorization: Bearer <token>`。
- 若收到 `401`：
  1. 尝试使用 `refresh_token` 调用 `/auth/refresh` 刷新。
  2. 若刷新成功，重试原请求。
  3. 若刷新失败（refresh_token 无效），则使用配置中的 `username`/`password` 调用 `/auth/login` 重新获取 token。
  4. 重登录成功后更新 token，重试原请求。
  5. 若重登录也失败，抛出错误并通知 WebUI。

#### 5.3.4 NCUID 适配辅助函数
> 注意：ncuid **不一定以 `nc_` 开头**（官方文档示例值为 `USR-ABCD1234`）。
> 服务端在 `?uid=` / `with_uid` / `to_uid` 参数中同时接受 uid 和 ncuid 值，
> 因此不需要前缀判断，统一使用 `_uid` 系列参数（与 63cede3 版本一致）。
```typescript
function toUidParam(id: string): { to_uid: string } {
  return { to_uid: id };
}
function withUidParam(id: string): { with_uid: string } {
  return { with_uid: id };
}
function profileQuery(id: string): string {
  return `/v1/users/profile?uid=${encodeURIComponent(id)}`;
}
```
这些函数用于自动构建正确的请求参数。

### 5.4 WebSocket 客户端

**文件**：`src/ws-client.ts`  
**职责**：建立 WebSocket 连接，发送/接收加密消息，自动重连，心跳保活。

#### 5.4.1 初始化
```typescript
const ws = new WsClient({
  host: 'oc.mcl0.dpdns.org',      // 从 backendOrigin 解析
  accessToken: config.accessToken,
  sessionId: session.sessionId,
  encKey: session.encKey,
  macKey: session.macKey,
  onMessage: (plainText) => handleMessage(plainText),
  onClose: () => { /* 重连逻辑 */ },
  heartbeatInterval: 30,  // 秒
});
await ws.connect();
```

#### 5.4.2 方法

| 方法 | 说明 |
|------|------|
| `connect()` | 建立 WebSocket 连接 |
| `disconnect()` | 主动断开连接 |
| `sendRaw(data: string)` | 发送原始字符串（用于心跳 `ping`） |
| `sendEncrypted(data: object)` | 将对象加密后发送（构造信封） |

**注意**：业务消息通过 HTTP API 发送，WS 仅接收推送和心跳。

#### 5.4.3 内部流程
1. 构造 URL：`ws://{host}/v1/ws?token={token}&sid={sessionId}`
2. 连接成功后，发送 `ping` 心跳（每 `heartbeatInterval` 秒）。
3. 接收消息时，调用 `decryptEnvelope` 解密，通过 `onMessage` 回调传递明文。
4. 遇到 `close` 或 `error`，进入指数退避重连（初始延迟 3s，最大 60s）。
5. 重连前重新握手获取新 session。

### 5.5 消息解析器

**文件**：`src/message-parser.ts`  
**职责**：解析消息体，提取 v2 格式、引用、@提及、阅后即焚等信息。

#### 5.5.1 `parseMessage(msg: any): ParsedMessage`

输入原始消息对象（来自 HTTP 历史或 WS 推送），输出结构化的 `ParsedMessage`：

```typescript
interface ParsedMessage {
  id: string;
  type: 'direct' | 'group';
  from: string;          // 发送者 NCUID 或 UID
  fromName: string;
  fromAvatar?: string;
  body: string;          // 原始 body（可能为 JSON 字符串）
  msgType: string;       // 'text', 'image', etc.
  mediaUrl?: string;
  thumbUrl?: string;
  createdAt: number;
  // 解析后的字段
  text?: string;          // 纯文本内容（去除 v2 包装）
  mentions?: Array<{ncuid: string, name: string}>;
  quote?: {
    id: string;
    from: string;
    fromName: string;
    text: string;
  };
  burnAfterSeconds?: number;
  isBurned?: boolean;
  fromSelf?: boolean;     // 是否自己发送
}
```

#### 5.5.2 工具函数
- `isV2(body: string): boolean`：判断是否为 v2 JSON。
- `extractText(body: string): string`：提取纯文本（忽略 v2 包装）。
- `buildV2(text: string, mentions?: Mention[], quote?: Quote): string`：构造 v2 消息体。

### 5.6 事件总线

**文件**：`src/event-bus.ts`  
基于 `EventEmitter`，用于模块间通信。

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `message` | `(parsed: ParsedMessage)` | 收到任何新消息（私聊/群聊） |
| `direct_message` | `(parsed: ParsedMessage)` | 私聊消息 |
| `group_message` | `(parsed: ParsedMessage)` | 群聊消息 |
| `direct_recall` | `(messageId: string, from: string)` | 私聊撤回 |
| `group_recall` | `(messageId: string, groupId: string, from: string)` | 群聊撤回 |
| `ready` | `()` | Bot 登录并成功连接 WS |
| `error` | `(error: Error)` | 发生错误 |
| `config_updated` | `(newConfig: Config)` | 配置更新 |

### 5.7 Bot 核心客户端

**文件**：`src/bot-client.ts`  
**职责**：整合所有模块，提供统一的对外接口。

#### 5.7.1 构造与初始化
```typescript
const bot = new BotClient({
  config: configManager,
  api: apiClient,
  pluginManager: pluginManager,
  eventBus: eventBus,
});
await bot.start();
```
启动流程：
1. 若配置中有 username/password，调用 `api.login()` 获取 token。
2. 初始化 WS 连接（握手、连接）。
3. 加载所有已启用的插件。
4. 启动 WebUI 服务器。

#### 5.7.2 主要方法
- `sendMessage(targetId: string, text: string, type?: 'direct' | 'group'): Promise<any>`
- `sendMedia(targetId: string, mediaUrl: string, msgType: string, thumbUrl?: string, type?: 'direct' | 'group'): Promise<any>`
- `replyToMessage(msg: ParsedMessage, text: string): Promise<any>`
- `getStatus(): { online: boolean, username: string, uid: string }`
- `stop(): Promise<void>`

---

## 6. WebUI 管理

### 6.1 服务器与端口

WebUI 使用 Express 搭建，默认监听 `127.0.0.1:4520`，可通过配置 `webuiPort` 修改。

启动代码（位于 `src/index.ts`）：
```typescript
import express from 'express';
import path from 'path';
import { apiRouter } from './webui/api';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../webui/public')));
app.use('/api', apiRouter);

const PORT = configManager.get('webuiPort') || 4520;
app.listen(PORT, '127.0.0.1', () => {
  logger.info(`WebUI started on http://127.0.0.1:${PORT}`);
});
```

### 6.2 前端界面

前端为单页应用，纯 HTML + CSS + JavaScript，位于 `webui/public/index.html`。

**布局**：
- **顶部状态栏**：显示 Bot 运行状态（在线/离线）、当前登录用户、运行时长。
- **标签页**："插件管理"、"Bot 配置"、"日志查看"。
- **插件列表**：每个插件显示名称、版本、描述、作者、启用状态，并提供切换开关。
- **配置页面**：表单输入后端地址、媒体地址、用户名、密码、日志级别等，保存按钮。
- **日志查看**：实时滚动显示最近日志（通过轮询或 WebSocket）。

### 6.3 REST API 端点

所有 API 返回 JSON，错误时含 `error` 字段。

| 方法 | 路径 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/api/plugins` | 获取所有插件信息 | - | `{ plugins: [ {name, version, description, author, enabled, ...} ] }` |
| POST | `/api/plugins/:name/toggle` | 切换插件启用状态 | - | `{ success: true, enabled: boolean }` |
| GET | `/api/bot/status` | 获取 Bot 状态 | - | `{ online: boolean, username: string, uid: string, uptime: number }` |
| GET | `/api/config` | 获取当前配置（隐藏密码） | - | `{ backendOrigin, mediaOrigin, username, logLevel, webuiPort, ... }` |
| POST | `/api/config` | 更新配置 | `{ backendOrigin?, mediaOrigin?, username?, password?, logLevel?, webuiPort? }` | `{ success: true }` |
| POST | `/api/bot/login` | 手动触发登录 | `{ username?, password? }`（可选） | `{ success: true }` |
| POST | `/api/bot/restart` | 重启 Bot 核心（重新登录+重连） | - | `{ success: true }` |
| GET | `/api/logs` | 获取最近日志 | - | `{ logs: string[] }` |

### 6.4 配置持久化

- 配置保存在 `config.json` 中，由 `ConfigManager` 负责读写。
- WebUI 的 `POST /api/config` 调用 `ConfigManager.save()`，合并更新并触发 `onUpdate` 事件。
- Bot 核心监听配置变化，若后端地址或凭证变更，自动重新登录。

### 6.5 登录与自动重登录

- Bot 启动时，若配置中有 `username` 和 `password`，自动调用 `/auth/login` 获取 token。
- 若配置中已有 `accessToken` 和 `refreshToken`，则直接使用。
- 每次 API 请求遇到 401 时，自动尝试刷新；若刷新失败，使用配置中的账号密码重新登录（并更新 token）。
- 重登录成功后，将新 token 持久化到 `config.json`。

---

## 7. 插件系统

### 7.1 插件结构

每个插件是一个独立的目录，位于 `plugins/` 下，必须包含 `manifest.json` 和入口文件（默认 `index.ts` 或 `index.js`）。

```
plugins/
  my-plugin/
    manifest.json      # 插件清单
    index.ts           # 入口（导出生命周期函数）
    package.json       # 可选（依赖）
    config.json        # 可选（插件自身配置）
    README.md          # 可选
```

### 7.2 清单文件（manifest.json）

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
- `name`：唯一标识，用于 API 和目录名。
- `enabled`：是否在启动时加载，WebUI 可切换。
- `main`：入口文件，默认 `index.ts`。

### 7.3 生命周期钩子

入口文件导出一个或多个生命周期函数：

```typescript
// 插件加载时调用
export function onLoad(api: PluginAPI): void { /* 初始化 */ }

// 收到消息时调用（所有消息）
export function onMessage(msg: ParsedMessage, api: PluginAPI): void { /* 处理 */ }

// 收到命令时调用（需先注册）
export function onCommand(cmd: string, args: string[], msg: ParsedMessage, api: PluginAPI): void { /* 处理 */ }

// 插件卸载或热重载前调用
export function onUnload(): void { /* 清理 */ }
```

**注意**：至少需要 `onLoad` 才能被加载。

### 7.4 插件 API（PluginAPI）

通过 `api` 参数暴露给插件的能力：

| 方法 | 说明 |
|------|------|
| `send(targetId: string, text: string, type?: 'direct' | 'group')` | 发送纯文本消息（自动适配 NCUID） |
| `sendMedia(targetId: string, mediaUrl: string, msgType: 'image' | 'voice' | 'video' | 'resource', thumbUrl?: string, type?: 'direct' | 'group')` | 发送媒体消息 |
| `reply(msg: ParsedMessage, text: string)` | 回复当前消息（自动判断类型） |
| `getUserProfile(uid: string): Promise<UserProfile>` | 获取用户资料（缓存 4 小时） |
| `getFriends(): Promise<Friend[]>` | 获取好友列表（缓存） |
| `getGroups(): Promise<Group[]>` | 获取群聊列表（缓存） |
| `registerCommand(name: string, handler: (args: string[], msg: ParsedMessage) => void)` | 注册命令（如 `ping`） |
| `on(event: string, listener: Function)` | 监听框架事件（同 EventBus） |
| `log(level: string, ...args: any[])` | 输出日志（自动添加插件名前缀） |
| `config: any` | 插件自身配置（从 `config.json` 读取） |

### 7.5 插件能力（无沙盒，完整 Node.js）

**这是 NokoriBot 插件系统的核心优势**：插件可以直接使用任何 Node.js 模块，拥有完整的系统访问权限。

#### 7.5.1 可用的 Node.js 模块
插件可以自由 `require` 或 `import` 任何 npm 包：

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

// 甚至可以使用子进程
import { exec } from 'child_process';
import { spawn } from 'child_process';
```

#### 7.5.2 插件可做的事情
- ✅ 读写本地文件（配置文件、数据文件、日志）
- ✅ 连接 SQLite/MySQL/PostgreSQL 等数据库
- ✅ 调用外部 REST API / WebSocket
- ✅ 执行系统命令（谨慎使用）
- ✅ 使用任何 npm 包
- ✅ 创建定时任务（node-cron、setInterval）
- ✅ 启动子进程
- ✅ 使用 WebSocket 客户端连接其他服务

#### 7.5.3 安全提示
由于插件拥有完整 Node.js 能力，**请确保只安装可信的插件**。框架本身不限制插件行为，信任由使用者自行管理。

### 7.6 热加载机制

- `PluginManager` 使用 `chokidar` 监控插件目录（`pluginsDir`）的文件变化。
- 当任何 `*.ts` 或 `*.js` 文件被修改时：
  1. 调用该插件的 `onUnload`（若存在）。
  2. 清除 `require.cache` 中该模块的引用。
  3. 重新 `require` 入口文件。
  4. 调用新模块的 `onLoad`。
- 若新模块抛出异常，则保留旧插件并记录错误，不影响 Bot 运行。

---

## 8. 插件开发指南

### 8.1 创建插件

1. 在 `plugins/` 下新建目录，如 `myplugin`。
2. 创建 `manifest.json`，填写元数据。
3. 创建 `index.ts`，编写逻辑。
4. （可选）创建 `config.json` 存放插件自己的配置。
5. 保存后，框架自动加载（若已启用）。

### 8.2 示例插件

**plugins/echo/manifest.json**：
```json
{
  "name": "echo",
  "version": "1.0.0",
  "description": "回显插件，回复 !echo 内容",
  "author": "LGCR837",
  "enabled": true
}
```

**plugins/echo/index.ts**：
```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';

export function onLoad(api: PluginAPI) {
  api.registerCommand('echo', (args: string[], msg: ParsedMessage) => {
    const text = args.join(' ');
    if (text) {
      api.reply(msg, text);
    } else {
      api.reply(msg, 'Usage: !echo <message>');
    }
  });

  api.onMessage((msg: ParsedMessage) => {
    if (msg.text && msg.text.toLowerCase().includes('hello') && !msg.fromSelf) {
      api.reply(msg, 'Hello! 👋');
    }
  });

  api.log('info', 'Echo plugin loaded');
}

export function onUnload() {
  console.log('Echo plugin unloaded');
}
```

### 8.3 使用数据库

**plugins/db-plugin/index.ts**：
```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';
import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function onLoad(api: PluginAPI) {
  // 初始化数据库
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

  // 注册命令
  api.registerCommand('note', (args: string[], msg: ParsedMessage) => {
    const action = args[0];
    const content = args.slice(1).join(' ');

    if (action === 'save' && content) {
      const stmt = db.prepare('INSERT INTO notes (user_id, content) VALUES (?, ?)');
      stmt.run(msg.from, content);
      api.reply(msg, '✅ 笔记已保存');
    } else if (action === 'list') {
      const stmt = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10');
      const rows = stmt.all(msg.from);
      if (rows.length === 0) {
        api.reply(msg, '📭 暂无笔记');
      } else {
        const list = rows.map((r: any) => `• ${r.content} (${r.created_at})`).join('\n');
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

### 8.4 调用外部 API

**plugins/weather/index.ts**：
```typescript
import { PluginAPI, ParsedMessage } from '../../src/types';
import axios from 'axios';

export function onLoad(api: PluginAPI) {
  api.registerCommand('weather', async (args: string[], msg: ParsedMessage) => {
    const city = args.join(' ') || 'Beijing';
    
    try {
      const resp = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
        params: {
          q: city,
          appid: 'your_api_key',
          units: 'metric',
          lang: 'zh_cn'
        }
      });
      
      const data = resp.data;
      const reply = `🌤 ${data.name} 天气\n` +
                    `温度: ${data.main.temp}°C\n` +
                    `天气: ${data.weather[0].description}\n` +
                    `湿度: ${data.main.humidity}%`;
      api.reply(msg, reply);
    } catch (error) {
      api.reply(msg, `❌ 查询失败: ${error.message}`);
    }
  });

  api.log('info', 'Weather plugin loaded');
}
```

### 8.5 调试技巧

- 设置 `config.json` 中 `logLevel: 'debug'`。
- 插件内使用 `api.log('debug', ...)` 输出详细信息。
- 使用 `console.log` 直接输出到控制台。
- 使用 Node.js 内置调试器：`node --inspect dist/index.js`，然后用 Chrome DevTools 连接。
- 在 WebUI 的"日志查看"页面实时查看日志。

---

## 9. 部署与运维

### 9.1 生产构建
```bash
npm run build        # 编译 TypeScript -> dist/
npm start            # 运行 dist/index.js
```

### 9.2 使用 PM2 守护
```bash
# 安装 PM2（全局）
npm install -g pm2# 启动 NokoriBot
pm2 start dist/index.js --name nokoribot

# 设置开机自启
pm2 startup
pm2 save

# 常用命令
pm2 logs nokoribot      # 查看日志
pm2 status              # 查看状态
pm2 restart nokoribot   # 重启
pm2 stop nokoribot      # 停止
```

### 9.3 日志管理
日志文件默认位于 `logs/` 目录下，按日期轮转：
- `logs/combined.log`：所有日志
- `logs/error.log`：仅错误日志

可通过 WebUI 的"日志查看"页面实时查看。

---

## 10. API 参考

### 10.1 BotClient

**构造** `new BotClient(options: BotClientOptions)`

**属性**：
- `api: ApiClient`
- `ws: WsClient`
- `plugins: PluginManager`
- `events: EventBus`
- `myUid: string`
- `myName: string`

**方法**：
- `start(): Promise<void>`
- `stop(): Promise<void>`
- `sendMessage(targetId: string, text: string, type?: 'direct' | 'group'): Promise<any>`
- `sendMedia(targetId: string, mediaUrl: string, msgType: string, thumbUrl?: string, type?: 'direct' | 'group'): Promise<any>`
- `replyToMessage(msg: ParsedMessage, text: string): Promise<any>`
- `getStatus(): { online: boolean, username: string, uid: string }`

### 10.2 ApiClient

**构造** `new ApiClient(options: ApiClientOptions)`

**方法**：
- `get<T>(path, params?)`
- `post<T>(path, data?)`
- `put<T>(path, data?)`
- `delete<T>(path)`
- `upload<T>(path, formData)`
- `login(username, password)`

### 10.3 WsClient

**构造** `new WsClient(options: WsClientOptions)`

**事件**（通过 EventEmitter）：
- `open`
- `message`（解密后文本）
- `close`
- `error`

### 10.4 PluginManager

**构造** `new PluginManager(pluginsDir: string, api: PluginAPI)`

**方法**：
- `loadAll(): Promise<void>`
- `loadPlugin(name: string): Promise<void>`
- `unloadPlugin(name: string): Promise<void>`
- `reloadPlugin(name: string): Promise<void>`
- `getAllPlugins(): PluginInfo[]`
- `togglePlugin(name: string): Promise<boolean>`

### 10.5 MessageParser

- `parseMessage(msg: any): ParsedMessage`
- `isV2(body: string): boolean`
- `extractText(body: string): string`
- `buildV2(text: string, mentions?: Mention[], quote?: Quote): string`

---

## 11. 常见问题

**Q：如何获取自己的 NCUID？**  
A：登录后，`BotClient.myUid` 会自动设置为 `user.ncuid`（优先）或 `user.uid`。

**Q：插件可以使用哪些 Node.js 模块？**  
A：任何 npm 包都可以。插件无沙盒限制，完全自由。

**Q：如何调试插件？**  
A：设置 `logLevel: 'debug'`，插件内使用 `api.log('debug', ...)`。也可用 `console.log`。

**Q：热加载不生效？**  
A：检查文件是否在 `pluginsDir` 内，且扩展名为 `.ts` 或 `.js`。TypeScript 需要 `ts-node` 或 `tsx` 支持。

**Q：WS 频繁重连？**  
A：检查网络，查看日志错误。可能是 Token 过期（框架会自动刷新）或 Session ID 失效（自动重新握手）。

**Q：WebUI 无法访问？**  
A：确认端口 4520 未被占用，监听地址为 `127.0.0.1`（如需远程访问，改为 `0.0.0.0` 并注意安全）。

**Q：如何更新协议实现？**  
A：将 `app.js` 中的 `Crypto`、`ensureWsSession`、`decryptEnvelope`、NCUID 工具函数等复制到对应的 TypeScript 文件即可。

**Q：账号密码错误怎么办？**  
A：在 WebUI 的配置页面修改用户名密码，保存后 Bot 会自动重新登录。也可直接编辑 `config.json` 后重启。

**Q：如何手动触发登录？**  
A：在 WebUI 中点击"重新登录"按钮，或调用 `POST /api/bot/login`。


