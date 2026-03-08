<div align="center">

<img src="./public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

本地化的聊天记录分析工具，通过 SQL 和 AI Agent 回顾你的社交记忆

[English](README.md) | 简体中文

[官网](https://chatlab.fun/cn/) · [项目文档](https://chatlab.fun/cn/usage/) · [路线图](https://chatlabfun.featurebase.app/roadmap) · [问题提交](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab 是一个专注于社交记录分析的 Web 应用。通过 AI 智能体和灵活的 SQL 引擎，你可以自由地拆解、查询甚至重构你的聊天记录数据。

目前已支持： WhatsApp、LINE、微信、QQ、Discord、Instagram、Telegram的聊天记录分析，即将支持： iMessage、Messenger、Kakao Talk。

## 核心特性

- 🚀 **极致性能**：使用流式计算与多线程并行架构，就算是百万条级别的聊天记录，依然拥有丝滑交互和响应。
- 🔒 **保护隐私**：聊天记录和配置都存在你的本地服务器，所有分析都在本地进行（AI 功能例外）。
- 🤖 **智能 AI Agent**：集成 10+ Function Calling 工具，支持动态调度，深度挖掘聊天记录中的更多有趣。
- 📊 **多维数据可视化**：提供活跃度趋势、时间规律分布、成员排行等多个维度的直观分析图表。
- 🧩 **格式标准化**：通过强大的数据抽象层，抹平不同聊天软件的格式差异，即使是再小众的聊天软件，也能分析。

## 使用指南

- [导出聊天记录指南](https://chatlab.fun/cn/usage/how-to-export.html)
- [标准化格式规范](https://chatlab.fun/cn/standard/chatlab-format.html)
- [故障排查指南](https://chatlab.fun/cn/usage/troubleshooting.html)

## 预览界面

预览更多请前往官网 [chatlab.fun](https://chatlab.fun/cn/)

![预览界面](/public/images/intro_zh.png)

## 系统架构

### 架构原则（Architecture Principles）

- **Local-first by default**：原始聊天记录、索引与配置默认留在服务器，优先保护隐私边界。
- **Streaming over buffering**：以流式解析和增量处理为核心，面向大体量导出文件保持稳定吞吐。
- **Composable intelligence**：AI 能力通过 Agent + Tool Calling 组合，避免将业务逻辑硬编码到单一模型。
- **Schema-first evolution**：围绕统一数据结构构建导入、查询、分析与可视化，降低演进成本。

### 运行时架构（Runtime Architecture）

- **后端（API + 数据层）**：`server/index.ts` 提供 Express 5 API 服务器，包含所有数据操作的 RESTful 端点。SQLite 数据库在服务端通过 better-sqlite3 管理。路由按领域组织在 `server/routes/` 中。
- **前端（交互层）**：基于 Vue 3 + Nuxt UI + Tailwind CSS，承载管理、聊天和分析界面。前端通过 `src/services/` 客户端层以 HTTP API 与后端通信。
- **开发模式**：Vite 开发服务器（端口 3400）将 `/api` 请求代理到 Express（端口 3001）。通过 `pnpm dev` 命令一键启动。
- **生产模式**：Express 以单进程服务构建后的 Vite 客户端静态文件和 API 请求。

### 数据闭环（Data Pipeline）

1. **导入接入**：`parser/` 先做格式嗅探，再由对应解析器执行标准化转换。
2. **数据落盘**：流式写入本地数据库，构建会话、成员、消息等核心实体。
3. **索引构建**：基于会话与时间维度生成分析索引，支撑时间线与检索能力。
4. **分析查询**：服务端查询服务提供活跃度、互动关系、SQL Lab 与 AI 检索等查询能力。
5. **结果呈现**：前端将查询结果转换为图表、榜单、时间线与对话式分析体验。

## 本地运行

### 环境要求

- Node.js >= 20
- pnpm

### 启动步骤

```bash
# 安装依赖
pnpm install

# 启动开发模式（同时启动 Express API 服务器和 Vite 开发服务器）
pnpm dev
```

Vite 开发服务器运行在端口 3400，将 `/api` 请求代理到端口 3001 的 Express 后端。

### 常用命令

```bash
# 类型检查（web + server）
pnpm type-check:all

# 仅检查 web
pnpm type-check:web

# 仅检查 server
pnpm type-check:server

# 代码检查和自动修复
pnpm lint

# 格式化文件
pnpm format

# 构建生产版本（检查服务端类型 + 构建 Vite 客户端）
pnpm build

# 运行测试
pnpm test

# 启动生产服务器（单进程提供 API 和构建后的客户端）
pnpm start
```

### 生产部署

```bash
# 构建应用
pnpm build

# 启动生产服务器
pnpm start
```

生产服务器运行在端口 3001（可通过 `PORT` 环境变量配置）。它以静态文件方式提供 Vite 构建的客户端，并处理所有 `/api/*` 路由。

## 贡献指南

提交 Pull Request 前请遵循以下原则：

- 明显的 Bug 修复可直接提交
- 对于新功能，请先提交 Issue 进行讨论，**未经讨论直接提交的 PR 会被关闭**
- 一个 PR 尽量只做一件事，若改动较大，请考虑拆分为多个独立的 PR

## 隐私政策与用户协议

使用本软件前，请阅读 [隐私政策与用户协议](./src/assets/docs/agreement_zh.md)

## License

AGPL-3.0 License
