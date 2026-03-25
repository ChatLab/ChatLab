<div align="center">

<img src="./public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

Rediscover your social memories with private, AI-powered analysis.

English | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja-JP.md)

[Official Website](https://chatlab.fun/) · [Download](https://chatlab.fun/?type=download) · [Documentation](https://chatlab.fun/usage/) · [Roadmap](https://chatlabfun.featurebase.app/roadmap) · [Issue Submission](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab is an open-source desktop app for understanding your social conversations. It combines a flexible SQL engine with AI agents so you can explore patterns, ask better questions, and extract insights from chat data, all on your own machine.

Currently supported: **WhatsApp, LINE, WeChat, QQ, Discord, Instagram, and Telegram**. Coming next: **iMessage, Messenger, and KakaoTalk**.

## Core Features

- 🚀 **Built for large histories**: Stream parsing and multi-worker processing keep imports and analysis responsive, even at million-message scale.
- 🔒 **Private by default**: Your chat data and settings stay local. No mandatory cloud upload of raw conversations.
- 🤖 **AI that can actually operate on data**: Agent + Function Calling workflows can search, summarize, and analyze chat records with context.
- 📊 **Insight-rich visual views**: See trends, time patterns, interaction frequency, rankings, and more in one place.
- 🧩 **Cross-platform normalization**: Different export formats are mapped into a unified model so you can analyze them consistently.
- 🔌 **MCP Server**: Expose chat analysis capabilities to Claude Code, Cursor, and other external AI tools via the Model Context Protocol — over HTTP/SSE or stdio.

## Usage Guides

- [Download Guide](https://chatlab.fun/?type=download)
- [Chat Record Export Guide](https://chatlab.fun/usage/how-to-export.html)
- [Standardized Format Specification](https://chatlab.fun/standard/chatlab-format.html)
- [Troubleshooting Guide](https://chatlab.fun/usage/troubleshooting.html)

## Preview

For more previews, please visit the official website: [chatlab.fun](https://chatlab.fun/)

![Preview Interface](/public/images/intro_en.png)

## MCP Server

ChatLab includes a built-in MCP (Model Context Protocol) server that lets external AI tools like Claude Code and Cursor directly query your chat data.

**Available tools (17 total):** `list_sessions`, `get_session_overview`, `get_members`, `get_member_stats`, `get_member_profile`, `get_member_name_history`, `get_interaction_frequency`, `search_messages`, `get_recent_messages`, `get_date_range_messages`, `get_message_context`, `get_conversation_between`, `export_messages`, `get_time_stats`, `get_word_frequency`, `execute_sql`, `get_schema`

### HTTP Mode

Start the server from **Settings → MCP Server**, then connect your client using the SSE endpoint:

```json
{
  "mcpServers": {
    "chatlab": {
      "url": "http://127.0.0.1:3000/sse"
    }
  }
}
```

A REST API is also available at `http://127.0.0.1:{port}/api/v1/`.

### Stdio Mode

No need to start anything in ChatLab. Copy the config snippet from **Settings → MCP Server → External Tool Configuration** and paste it into your client (e.g. `claude_desktop_config.json`):

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

The client manages the process lifecycle automatically.

## System Architecture

### Architecture Principles

- **Local-first by default**: Raw chat data, indexes, and settings remain on-device unless you explicitly choose otherwise.
- **Streaming over buffering**: Stream-first parsing and incremental processing keep large imports stable and memory-efficient.
- **Composable intelligence**: AI features are assembled through Agent + Tool Calling, not hard-coded into one model path.
- **Schema-first evolution**: Import, query, analysis, and visualization share a consistent data model that scales with new features.

### Runtime Architecture

- **Main Process (control plane)**: `electron/main/index.ts` handles lifecycle and windows. `electron/main/ipc/` defines domain-scoped IPC, while `electron/main/ai/` and `electron/main/i18n/` provide shared AI and localization services.
- **Worker Layer (compute plane)**: `electron/main/worker/` runs import, indexing, and query tasks via `workerManager`, keeping CPU-heavy work off the UI thread.
- **Renderer Layer (interaction plane)**: Vue 3 + Nuxt UI + Tailwind CSS drive management, private chat, group chat, and analysis interfaces. `electron/preload/index.ts` exposes tightly scoped APIs for secure process boundaries.

### Data Pipeline

1. **Ingestion**: `parser/` detects file format and dispatches to the matching parser module.
2. **Persistence**: Stream-based writes populate core local entities: sessions, members, and messages.
3. **Indexing**: Session- and time-oriented indexes are built for timeline navigation and retrieval.
4. **Query & Analysis**: `worker/query/*` powers activity metrics, interaction analysis, SQL Lab, and AI-assisted exploration.
5. **Presentation**: The renderer turns query output into charts, rankings, timelines, and conversational analysis flows.

### Extensibility & Reliability

- **Pluggable parser architecture**: Adding a new import source is mostly an extension in `parser/formats/*`, without reworking downstream query logic.
- **Full + incremental import paths**: `streamImport.ts` and `incrementalImport.ts` support both first-time onboarding and ongoing updates.
- **Modular IPC boundaries**: Domain-based IPC segmentation reduces cross-layer coupling and limits permission spread.
- **Unified i18n evolution**: Main and renderer processes share an i18n system that can evolve with product scope.

---

## Local Development

### Requirements

- Node.js >= 20
- pnpm

### Setup

```bash
# install dependencies
pnpm install

# run electron app in dev mode
pnpm dev
```

If Electron encounters exceptions during startup, you can try using `electron-fix`:

```bash
npm install electron-fix -g
electron-fix start

```

## Contributing

Please follow these principles before submitting a Pull Request:

- Obvious bug fixes can be submitted directly.
- For new features, please submit an Issue for discussion first; **PRs submitted without prior discussion will be closed**.
- Keep one PR focused on one task; if changes are extensive, consider splitting them into multiple independent PRs.

## Privacy Policy & User Agreement

Before using this software, please read the [Privacy Policy & User Agreement](./src/assets/docs/agreement_en.md).

## License

AGPL-3.0 License
