<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/ChatLab/ChatLab/raw/main/public/images/banner-light.png">
    <img src="https://github.com/ChatLab/ChatLab/raw/main/public/images/banner.png" alt="ChatLab" title="ChatLab" width="500" />
  </picture>

Your chat history, finally yours.

English | [简体中文](./README.zh-CN.md)

[Official Website](https://chatlab.fun/) · [Documentation](https://docs.chatlab.fun/en/usage/) · [Roadmap](https://chatlab.fun/cn/roadmap/tasks)

</div>

ChatLab is an open-source desktop app for understanding your social conversations. It combines a flexible SQL engine with AI agents so you can explore patterns, ask better questions, and extract insights from chat data, all on your own machine.

Currently supported: **WhatsApp, LINE, WeChat, QQ, Discord, Instagram, and Telegram**. Coming next: **iMessage, Messenger, and KakaoTalk**.

## Core Features

- 🚀 **Built for large histories**: Stream parsing and multi-worker processing keep imports and analysis responsive, even at million-message scale.
- 🔒 **Private by default**: Your chat data and settings stay local. No mandatory cloud upload of raw conversations.
- 🤖 **AI that can actually operate on data**: Agent + Function Calling workflows can search, summarize, and analyze chat records with context.
- 📊 **Insight-rich visual views**: See trends, time patterns, interaction frequency, rankings, and more in one place.
- 🧩 **Cross-platform normalization**: Different export formats are mapped into a unified model so you can analyze them consistently.

## Usage Guides

- [Download Guide](https://chatlab.fun/?type=download)
- [Chat Record Export Guide](https://docs.chatlab.fun/en/usage/how-to-export)
- [Standardized Format Specification](https://docs.chatlab.fun/en/standard/chatlab-format)
- [Troubleshooting Guide](https://docs.chatlab.fun/en/usage/troubleshooting)

## Preview

For more previews, please visit the official website: [chatlab.fun](https://chatlab.fun/)

![Preview Interface](/public/images/intro_en.png)

## System Architecture

### Architecture Principles

- **Local-first by default**: Raw chat data, indexes, and settings remain on-device unless you explicitly choose otherwise.
- **Streaming over buffering**: Stream-first parsing and incremental processing keep large imports stable and memory-efficient.
- **Composable intelligence**: AI features are assembled through Agent + Tool Calling, not hard-coded into one model path.
- **Schema-first evolution**: Import, query, analysis, and visualization share a consistent data model that scales with new features.

### Runtime Architecture

- **Main Process (control plane)**: `apps/desktop/main/index.ts` handles lifecycle and windows. `apps/desktop/main/ipc/` defines domain-scoped IPC. Core AI, query, NLP, import, and merge logic lives in shared packages (`packages/core`, `packages/node-runtime`, `packages/tools`); `apps/desktop/main/ai/` and `apps/desktop/main/i18n/` are thin Electron adaptation layers.
- **Worker Layer (compute plane)**: `apps/desktop/main/worker/` runs import, indexing, and query tasks via `workerManager`, delegating core logic to `@openchatlab/core` and `@openchatlab/node-runtime`.
- **Renderer Layer (interaction plane)**: Vue 3 + Nuxt UI + Tailwind CSS drive management, private chat, group chat, and analysis interfaces. `apps/desktop/preload/index.ts` exposes tightly scoped APIs for secure process boundaries.

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

## Privacy Policy & User Agreement

Before using this software, please read the [Privacy Policy & User Agreement](./src/assets/docs/agreement_en.md).

## Community

Please follow these principles before submitting a Pull Request:

- Obvious bug fixes can be submitted directly.
- For new features, please submit an Issue for discussion first; **PRs submitted without prior discussion will be closed**.
- Keep one PR focused on one task; if changes are extensive, consider splitting them into multiple independent PRs.

Thanks to all contributors:

<a href="https://github.com/ChatLab/ChatLab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatLab/ChatLab" />
</a>

## License

AGPL-3.0 License
