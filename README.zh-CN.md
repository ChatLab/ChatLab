<div align="center">

<img src="./public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

本地化的聊天记录分析工具，通过 AI Agent 回顾你的社交记忆

[English](./README.md) | 简体中文 | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja-JP.md)

[官网](https://chatlab.fun/cn/) · [下载指南](https://chatlab.fun/cn/?type=download) · [项目文档](https://chatlab.fun/cn/usage/) · [路线图](https://chatlabfun.featurebase.app/roadmap) · [问题提交](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab 是一个专注于社交记录分析的本地化应用。通过 AI Agent和灵活的 SQL 引擎，你可以自由地拆解、查询甚至重构你的聊天记录数据。

目前已支持： WhatsApp、LINE、QQ、Discord、Instagram、Telegram的聊天记录分析，即将支持： iMessage、Messenger、Kakao Talk。

## 核心特性

- 🚀 **极致性能**：使用流式计算与多线程并行架构，就算是百万条级别的聊天记录，依然拥有丝滑交互和响应。
- 🔒 **保护隐私**：聊天记录和配置都存在你的本地数据库，所有分析都在本地进行（AI 功能例外）。
- 🤖 **智能 AI Agent**：集成 10+ Function Calling 工具，支持动态调度，深度挖掘聊天记录中的更多有趣。
- 📊 **多维数据可视化**：提供活跃度趋势、时间规律分布、成员排行等多个维度的直观分析图表。
- 🧩 **格式标准化**：通过强大的数据抽象层，抹平不同聊天软件的格式差异，即使是再小众的聊天软件，也能分析。
- 🔌 **MCP Server**：通过 Model Context Protocol 将聊天分析能力开放给 Claude Code、Cursor 等外部 AI 工具，支持 HTTP 和 Stdio 两种接入方式。

## 使用指南

- [下载 ChatLab 指南](https://chatlab.fun/cn/?type=download)
- [导出聊天记录指南](https://chatlab.fun/cn/usage/how-to-export.html)
- [标准化格式规范](https://chatlab.fun/cn/standard/chatlab-format.html)
- [故障排查指南](https://chatlab.fun/cn/usage/troubleshooting.html)

## 预览界面

预览更多请前往官网 [chatlab.fun](https://chatlab.fun/cn/)

![预览界面](/public/images/intro_zh.png)

## MCP Server

ChatLab 内置了一个 MCP（Model Context Protocol）服务，可以让 Claude Code、Cursor 等外部 AI 工具直接调用聊天记录的分析能力。

**可用工具（共 17 个）：** `list_sessions`、`get_session_overview`、`get_members`、`get_member_stats`、`get_member_profile`、`get_member_name_history`、`get_interaction_frequency`、`search_messages`、`get_recent_messages`、`get_date_range_messages`、`get_message_context`、`get_conversation_between`、`export_messages`、`get_time_stats`、`get_word_frequency`、`execute_sql`、`get_schema`

### HTTP 模式

在 **设置 → MCP Server** 中启动服务，然后用 SSE 端点接入客户端：

```json
{
  "mcpServers": {
    "chatlab": {
      "url": "http://127.0.0.1:3000/sse"
    }
  }
}
```

同时提供 REST API：`http://127.0.0.1:{port}/api/v1/`

### Stdio 模式

无需在 ChatLab 中手动启动。在 **设置 → MCP Server → 外部工具配置信息** 中复制配置片段，粘贴到客户端配置文件（如 `claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "chatlab": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js", "--db-dir", "/path/to/databases"]
    }
  }
}
```

客户端会自动管理进程的生命周期。

## 系统架构

### 架构原则（Architecture Principles）

- **Local-first by default**：原始聊天记录、索引与配置默认留在本地，优先保护隐私边界。
- **Streaming over buffering**：以流式解析和增量处理为核心，面向大体量导出文件保持稳定吞吐。
- **Composable intelligence**：AI 能力通过 Agent + Tool Calling 组合，避免将业务逻辑硬编码到单一模型。
- **Schema-first evolution**：围绕统一数据结构构建导入、查询、分析与可视化，降低演进成本。

### 运行时架构（Runtime Architecture）

- **Main Process（控制层）**：`electron/main/index.ts` 负责生命周期与窗口；`electron/main/ipc/` 提供分域 IPC；`electron/main/ai/` 与 `electron/main/i18n/` 提供 AI 与国际化基础能力。
- **Worker Layer（计算层）**：`electron/main/worker/` 通过 `workerManager` 调度任务，隔离导入、索引与查询计算，降低 UI 阻塞风险。
- **Renderer Layer（交互层）**：基于 Vue 3 + Nuxt UI + Tailwind CSS，承载管理、私聊、群聊与分析视图；通过 `electron/preload/index.ts` 暴露受控 API，确保渲染层与主进程隔离。

### 数据闭环（Data Pipeline）

1. **导入接入**：`parser/` 先做格式嗅探，再由对应解析器执行标准化转换。
2. **数据落盘**：流式写入本地数据库，构建会话、成员、消息等核心实体。
3. **索引构建**：基于会话与时间维度生成分析索引，支撑时间线与检索能力。
4. **分析查询**：`worker/query/*` 提供活跃度、互动关系、SQL Lab 与 AI 检索等查询能力。
5. **结果呈现**：渲染层将查询结果转换为图表、榜单、时间线与对话式分析体验。

## 本地运行

### 环境要求

- Node.js >= 20
- pnpm

### 启动步骤

```bash
# 安装依赖
pnpm install

# 启动开发模式
pnpm dev
```

若 Electron 在启动时异常，可尝试使用 `electron-fix`：

```bash
npm install electron-fix -g
electron-fix start
```

## 贡献指南

提交 Pull Request 前请遵循以下原则：

- 明显的 Bug 修复可直接提交
- 对于新功能，请先提交 Issue 进行讨论，**未经讨论直接提交的 PR 会被关闭**
- 一个 PR 尽量只做一件事，若改动较大，请考虑拆分为多个独立的 PR

## 隐私政策与用户协议

使用本软件前，请阅读 [隐私政策与用户协议](./src/assets/docs/agreement_zh.md)

## License

AGPL-3.0 License
