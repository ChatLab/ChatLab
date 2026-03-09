# ChatLab — Claude Code Guide

## 项目概述

ChatLab 是一个本地化聊天记录分析桌面应用，基于 Electron + Vue 3 构建。通过 SQL 引擎和 AI Agent，帮助用户回顾和分析聊天数据。

**支持平台：** WhatsApp、LINE、微信（WeChat）、QQ、Discord、Instagram、Telegram
**License：** AGPL-3.0

---

## 开发环境

### 必要条件

- Node.js >= 20
- pnpm（包管理器）

### 启动开发

```bash
pnpm install
pnpm dev
```

### 构建

```bash
pnpm build          # 构建所有平台
pnpm build:mac      # 构建 macOS 版本
pnpm build:win      # 构建 Windows 版本
```

### 类型检查

```bash
pnpm type-check:node   # 检查 Electron 主进程
pnpm type-check:web    # 检查 Vue 渲染进程
```

---

## 项目结构

```
ChatLab/
├── electron/main/           # Electron 主进程
│   ├── database/            # 数据库核心（创建、迁移、分析）
│   ├── parser/              # 格式解析器（支持10+格式）
│   │   └── formats/         # 各平台格式实现
│   ├── worker/              # Worker 线程（CPU密集任务隔离）
│   │   ├── query/           # 查询模块（basic/messages/advanced/sessions/sql）
│   │   └── core/            # 底层数据库操作
│   ├── ai/                  # AI Agent + Tool Calling + RAG
│   │   └── tools/definitions/  # 各 AI 工具定义
│   ├── ipc/                 # IPC 处理器（分域管理）
│   ├── nlp/                 # NLP 工具（中文分词、词频统计）
│   ├── network/             # 网络与代理
│   └── merger/              # 会话合并
├── src/                     # Vue 3 渲染进程（UI）
│   ├── components/          # UI 组件
│   ├── stores/              # Pinia 状态管理
│   ├── types/               # TypeScript 类型（包括 base.ts 核心类型）
│   └── utils/               # 工具函数
├── packages/                # 可视化图表包
│   ├── chart-cluster/
│   ├── chart-interaction/
│   ├── chart-message/
│   └── chart-ranking/
├── mcp/                     # MCP（Model Context Protocol）服务器
│   └── wechat-db/           # 微信 4.x 数据库 MCP 工具
└── skills/                  # 扩展功能模块
```

---

## 核心架构

### 运行时层次

```
渲染进程 (Vue 3)
    ↓ IPC
主进程 (Electron Main)
    ↓ Worker Message
Worker 线程 (dbWorker)
    ↓
SQLite 数据库 (better-sqlite3)
```

### 数据库 Schema（ChatLab 内部数据库）

ChatLab 将导入的聊天记录存储在本地 SQLite 数据库中，核心表：

- `meta` — 会话元数据（平台、名称、导入时间）
- `member` — 成员信息（平台ID、账号名、群昵称）
- `member_name_history` — 名称变更历史
- `message` — 消息记录（时间戳、类型、内容）
- `chat_session` — 时间段会话分组
- `message_context` — 消息与会话的映射

Schema 版本当前为 v3，通过 `electron/main/database/migrations.ts` 管理迁移。

### 数据流

1. 用户选择文件 → IPC `chat:selectFile`
2. 格式嗅探 → `electron/main/parser/formats/index.ts`
3. 流式解析 → 对应格式解析器（`AsyncGenerator<ParseEvent>`）
4. 写入数据库 → `electron/main/database/core.ts#importData()`
5. 构建索引 → Worker 线程计算会话、词频等
6. 查询渲染 → `electron/main/worker/query/*` → 图表/列表

---

## 关键文件

| 文件路径 | 作用 |
|----------|------|
| `electron/main/database/core.ts` | 数据库创建、打开、迁移、导入 |
| `electron/main/database/analysis.ts` | 高级分析查询（活跃度、龙王等）|
| `electron/main/worker/dbWorker.ts` | Worker 线程入口，查询分发 |
| `electron/main/worker/query/basic.ts` | 基础统计查询 |
| `electron/main/worker/query/messages.ts` | 消息搜索和上下文查询 |
| `electron/main/worker/query/sql.ts` | SQL Lab、Schema 查询、插件查询 |
| `electron/main/parser/formats/index.ts` | 格式注册和检测入口 |
| `electron/main/ai/tools/definitions/index.ts` | AI 工具注册 |
| `src/types/base.ts` | 核心类型定义（MessageType、Platform 等）|
| `electron/preload/index.ts` | 渲染层与主进程的受控 API 桥接 |

---

## 添加新格式解析器

1. 在 `electron/main/parser/formats/` 创建新文件（参考 `weflow.ts`）
2. 实现 `FormatFeature` + `Parser`（`AsyncGenerator<ParseEvent>`）
3. 在 `electron/main/parser/formats/index.ts` 注册

## 添加新 AI 工具

1. 在 `electron/main/ai/tools/definitions/` 创建工具文件（参考 `search-messages.ts`）
2. 导出 `createTool(context: ToolContext): AgentTool`
3. 在 `index.ts` 注册工具

---

## MCP 工具（微信数据库直连）

ChatLab 提供了 MCP（Model Context Protocol）服务器，支持直接读取 macOS 微信 4.x 的加密数据库，无需手动导出。

详见：[mcp/wechat-db/README.md](./mcp/wechat-db/README.md)

---

## 代码规范

- TypeScript 严格模式
- Vue 3 Composition API
- 使用 `prettier` 格式化（配置见 `.prettierrc.yaml`）
- 使用 `eslint` 检查（配置见 `.eslintrc.mjs`）
- Worker 线程中的数据库操作必须是同步的（better-sqlite3）
- IPC 处理器按功能域划分到 `electron/main/ipc/` 下各自文件

## 注意事项

- `better-sqlite3` 是同步 API，必须在 Worker 线程中使用，不能在主线程使用
- 渲染进程通过 `electron/preload/index.ts` 的受控 API 访问主进程功能
- 所有用户数据默认存储在本地，AI 功能除外
- 解析器输出的 `ParseEvent` 是 `AsyncGenerator`，支持流式处理
