<div align="center">

# NokoriBot

**基于 Node.js + TypeScript 的 OldChat 聊天机器人框架**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

NokoriBot 是为 OldChat 社交平台设计的聊天机器人框架。协议层基于 [oldchat-api-sdk-javascript](https://github.com/LGCR837/oldchat-api-sdk-javascript) 实现（ECDH 签名、v1↔v2 映射、候选降级），支持热加载插件与 WebUI 管理界面。

## 特性

- **SDK 驱动** — ECDH 加密握手、v1↔v2 自动映射、候选后端降级、端点熔断均由 [oldchat-api-sdk-javascript](https://github.com/LGCR837/oldchat-api-sdk-javascript) 处理
- **NCUID 兼容** — 原生支持 `nc_` 前缀与旧 UID 自动适配
- **WebSocket 长连接** — 自动重连、心跳保活、加密消息收发
- **插件无沙盒** — 完整 Node.js 能力，可自由使用 fs、数据库、HTTP 客户端等
- **热加载** — 修改插件代码即时生效，无需重启
- **WebUI 管理** — 插件管理、配置编辑、日志查看、实时状态监控
- **自动 Token 管理** — 401 自动刷新，刷新失败自动重登录

## 快速开始

```bash
git clone https://github.com/LGCR837/NokoriBot.git
cd NokoriBot
npm install
```

创建 `config.json`：

```json
{
  "backendOrigin": "http://oc.mcl0.dpdns.org",
  "mediaOrigin": "http://60.205.94.101:8080",
  "username": "your_username",
  "password": "your_password",
  "logLevel": "info",
  "webuiPort": 4520
}
```

启动：

```bash
npm run dev:full      # 开发模式（构建前端 + 后端热重载）
# 或
npm run build:webui && npm run build && npm start   # 生产模式
```

打开 `http://127.0.0.1:4520` 访问 WebUI。

## 项目结构

```
NokoriBot/
├── src/
│   ├── index.ts              # 入口
│   ├── bot-client.ts         # Bot 核心客户端
│   ├── api-client.ts         # HTTP 客户端
│   ├── ws-client.ts          # WebSocket 客户端
│   ├── message-parser.ts     # 消息解析器
│   ├── event-bus.ts          # 事件总线
│   ├── config-manager.ts     # 配置管理
│   ├── logger.ts             # 日志（winston）
│   ├── paths.ts              # 路径常量
│   ├── types.ts              # 类型定义
│   ├── protocol/             # 协议层（crypto, SDK, NCUID）
│   ├── plugins/              # 插件管理器
│   └── webui/                # WebUI 服务器
├── webui/                    # React 前端
│   ├── src/                  # 源码
│   └── dist/                 # 构建产物
├── plugins/                  # 插件目录
├── config.json               # 配置文件
├── DEV.md                    # 框架开发文档
└── PLUGIN_DEV.md             # 插件开发文档
```

## 文档

- [框架开发文档](DEV.md) — 架构设计、核心模块、部署运维
- [插件开发文档](PLUGIN_DEV.md) — 插件结构、API 参考、示例

## 许可证

[MIT](LICENSE)
