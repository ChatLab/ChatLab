<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/ChatLab/ChatLab/raw/main/public/images/banner-light.png">
    <img src="https://github.com/ChatLab/ChatLab/raw/main/public/images/banner.png" alt="ChatLab" title="ChatLab" width="500" />
  </picture>

聊天记忆驱动的 AI Agent

[English](README.md) | 简体中文

[官网](https://chatlab.fun/cn/) · [文档](https://docs.chatlab.fun/cn/) · [快速开始](https://docs.chatlab.fun/cn/usage/quick-start) · [路线图](https://chatlab.fun/cn/roadmap/tasks) · [Releases](https://github.com/ChatLab/ChatLab/releases)

</div>

ChatLab 是一个专注于聊天记录分析的本地化应用。通过 AI Agent和灵活的 SQL 引擎，你可以自由地分析你的聊天记录数据。

目前已支持：**WhatsApp、LINE、QQ、Discord、Instagram、Telegram、iMessage、Google Chat**。即将支持：Messenger、KakaoTalk。

> 首次安装？从这里开始：[快速开始](https://docs.chatlab.fun/cn/usage/quick-start)

## 核心特性

- 🚀 **极致性能**：使用流式计算与多线程并行架构，就算是百万条级别的聊天记录，依然拥有丝滑交互和响应。
- 🔒 **保护隐私**：聊天记录和配置都存在你的本地数据库，所有分析都在本地进行（AI 功能例外）。
- 🤖 **智能 AI Agent**：集成 24+ Function Calling 工具，支持动态调度，深度挖掘聊天记录中的更多有趣。
- 📊 **多维数据可视化**：提供活跃度趋势、时间规律分布、成员排行等多个维度的直观分析图表。
- 🧩 **格式标准化**：通过强大的数据抽象层，抹平不同聊天软件的格式差异，即使是再小众的聊天软件，也能分析。

## 安装

### 桌面端

前往[官网](https://chatlab.fun/cn/?type=download)或 [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) 下载对应操作系统的安装包，双击安装即可。

### CLI

需要 Node.js ≥ 20。

```bash
npm i chatlab-cli -g
```

启动 ChatLab：

```bash
chatlab start            # 启动 API + Web UI，并在浏览器中打开
chatlab start --no-open  # 启动 API + Web UI，但不自动打开浏览器
chatlab start --headless # 仅启动 API，不挂载 Web UI（供脚本 / AI Agent 调用）
```

常用选项：`--port <端口>`（默认 3110）、`--host <地址>`、`--token <令牌>`。

如果希望服务常驻后台（开机自启 + 崩溃自动重启）：

```bash
chatlab start --daemon   # 注册为系统服务（macOS / Linux）
chatlab status           # 查看常驻状态
chatlab stop             # 停止并取消常驻
```

完整使用说明请见[快速开始指南](https://docs.chatlab.fun/cn/usage/quick-start)。

## 使用指南

- [下载 ChatLab 指南](https://chatlab.fun/cn/?type=download)
- [导出聊天记录指南](https://docs.chatlab.fun/cn/usage/how-to-export)
- [标准化格式规范](https://docs.chatlab.fun/cn/standard/chatlab-format)
- [故障排查指南](https://docs.chatlab.fun/cn/usage/troubleshooting)

## 预览界面

预览更多请前往官网 [chatlab.fun](https://chatlab.fun/cn/)

![预览界面](public/images/intro_zh.png)

## 架构概览

ChatLab 是一个基于 pnpm monorepo 的工程，桌面端使用 Electron + Vue 3 + Nuxt UI + Tailwind CSS，核心业务逻辑沉淀在共享包（`@openchatlab/core`、`@openchatlab/node-runtime`、`@openchatlab/tools`），桌面端与 CLI 服务端复用同一份逻辑，保持功能同步。

数据流分五个阶段：**格式嗅探 → 流式解析 → 本地落盘 → SQL + AI 查询 → 可视化呈现**。

详细架构请参考[项目文档](https://docs.chatlab.fun/cn/intro)。

### 架构原则

- **Local-first by default**：原始聊天记录、索引与配置默认留在本地，优先保护隐私边界。
- **Streaming over buffering**：以流式解析和增量处理为核心，面向大体量导出文件保持稳定吞吐。
- **Composable intelligence**：AI 能力通过 Agent + Tool Calling 组合，避免将业务逻辑硬编码到单一模型。
- **Schema-first evolution**：围绕统一数据结构构建导入、查询、分析与可视化，降低演进成本。

---

## 本地开发

完整协作者说明见[开发指南](https://docs.chatlab.fun/cn/contributing/development)。

### 环境要求

- Node.js >= 24 < 25
- pnpm >= 9 < 10

### 启动步骤

```bash
# 安装依赖
pnpm install

# 启动开发模式 — 会提示选择要启动的目标
pnpm dev
```

也可以直接启动指定目标：

```bash
pnpm dev:desktop   # Electron 桌面端
pnpm dev:cli-web   # CLI Web 前端 + 本地服务
pnpm dev:web-wasm  # 纯浏览器 Web WASM
pnpm dev:serve     # 仅 CLI 服务端
pnpm docs:dev      # 文档站
```

若 Electron 在启动时异常，可尝试使用 `electron-fix`：

```bash
npm install electron-fix -g
electron-fix start
```

## 隐私政策与用户协议

使用本软件前，请阅读 [隐私政策与用户协议](src/assets/docs/agreement_zh.md)

## 社区

提交 Pull Request 前请遵循以下原则：

- 明显的 Bug 修复可直接提交
- 对于新功能，请先提交 Issue 进行讨论，**未经讨论直接提交的 PR 会被关闭**
- 一个 PR 尽量只做一件事，若改动较大，请考虑拆分为多个独立的 PR
- 本地运行、目录职责、测试检查和 AI 协作说明见[开发指南](https://docs.chatlab.fun/cn/contributing/development)

感谢所有为 ChatLab 做出贡献的人！

<a href="https://github.com/ChatLab/ChatLab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatLab/ChatLab" />
</a>

## License

AGPL-3.0 License
