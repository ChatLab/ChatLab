<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/ChatLab/ChatLab/raw/main/public/images/banner-light.png">
    <img src="https://github.com/ChatLab/ChatLab/raw/main/public/images/banner.png" alt="ChatLab" title="ChatLab" width="500" />
  </picture>

Your chat history, finally yours.

English | [简体中文](./README.zh-CN.md)

[Official Website](https://chatlab.fun/) · [Docs](https://docs.chatlab.fun/) · [Quick Start](https://docs.chatlab.fun/usage/quick-start) · [Roadmap](https://chatlab.fun/roadmap/tasks) · [Releases](https://github.com/ChatLab/ChatLab/releases)

</div>

ChatLab is an open-source desktop app for understanding your social conversations. It combines a flexible SQL engine with AI agents so you can explore patterns, ask better questions, and extract insights from chat data, all on your own machine.

Currently supported: **WhatsApp, LINE, QQ, Discord, Instagram, Telegram, iMessage, and Google Chat**. Coming next: **Messenger and KakaoTalk**.

> New install? Start here: [Getting started](https://docs.chatlab.fun/usage/quick-start)

## Core Features

- 🚀 **Built for large histories**: Stream parsing and multi-worker processing keep imports and analysis responsive, even at million-message scale.
- 🔒 **Private by default**: Your chat data and settings stay local. No mandatory cloud upload of raw conversations.
- 🤖 **AI that can actually operate on data**: Agent + Function Calling workflows (24+ tools) can search, summarize, and analyze chat records with context.
- 📊 **Insight-rich visual views**: See trends, time patterns, interaction frequency, rankings, and more in one place.
- 🧩 **Cross-platform normalization**: Different export formats are mapped into a unified model so you can analyze them consistently.

## Installation

### Desktop App

Download the installer for your OS from the [official website](https://chatlab.fun/?type=download) or [GitHub Releases](https://github.com/ChatLab/ChatLab/releases), then double-click to install.

### CLI

Requires Node.js ≥ 20.

```bash
npm i chatlab-cli -g
```

Start ChatLab:

```bash
chatlab start            # Start API + Web UI, auto-open in browser
chatlab start --no-open  # Start API + Web UI, skip auto-open
chatlab start --headless # API only, no Web UI (for scripts / AI Agents)
```

Common options: `--port <port>` (default 3110), `--host <address>`, `--token <token>`.

To run as a persistent background service (auto-start on login + auto-restart on crash):

```bash
chatlab start --daemon   # Install as system service (macOS / Linux)
chatlab status           # Check service status
chatlab stop             # Stop and uninstall service
```

For a full walkthrough, see the [Quick Start guide](https://docs.chatlab.fun/usage/quick-start).

## Usage Guides

- [Download Guide](https://chatlab.fun/?type=download)
- [Chat Record Export Guide](https://docs.chatlab.fun/usage/how-to-export)
- [Standardized Format Specification](https://docs.chatlab.fun/standard/chatlab-format)
- [Troubleshooting Guide](https://docs.chatlab.fun/usage/troubleshooting)

## Preview

For more previews, please visit the official website: [chatlab.fun](https://chatlab.fun/)

![Preview Interface](/public/images/intro_en.png)

## Architecture Overview

ChatLab is a pnpm monorepo built on Electron + Vue 3 + Nuxt UI + Tailwind CSS. Core business logic lives in shared packages (`@openchatlab/core`, `@openchatlab/node-runtime`, `@openchatlab/tools`), consumed by both the desktop app and the CLI service — so they stay in sync.

Data flows in five stages: **format detection → stream parsing → local persistence → SQL + AI query → visualization**.

For a deep dive, see the [architecture documentation](https://docs.chatlab.fun/intro).

### Architecture Principles

- **Local-first by default**: Raw chat data, indexes, and settings remain on-device unless you explicitly choose otherwise.
- **Streaming over buffering**: Stream-first parsing and incremental processing keep large imports stable and memory-efficient.
- **Composable intelligence**: AI features are assembled through Agent + Tool Calling, not hard-coded into one model path.
- **Schema-first evolution**: Import, query, analysis, and visualization share a consistent data model that scales with new features.

---

## Local Development

For complete contributor instructions, see the [Development Guide](https://docs.chatlab.fun/contributing/development).

### Requirements

- Node.js >= 24 < 25
- pnpm >= 9 < 10

### Setup

```bash
# Install dependencies
pnpm install

# Start dev mode — prompts you to choose which app to launch
pnpm dev
```

Or launch a specific target directly:

```bash
pnpm dev:desktop   # Electron desktop app
pnpm dev:cli-web   # CLI Web frontend + local server
pnpm dev:web-wasm  # Browser-only Web WASM
pnpm dev:serve     # CLI server only
pnpm docs:dev      # Docs site
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
- For local setup, repository structure, checks, and AI collaboration notes, see the [Development Guide](https://docs.chatlab.fun/contributing/development).

Thanks to all contributors:

<a href="https://github.com/ChatLab/ChatLab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatLab/ChatLab" />
</a>

## License

AGPL-3.0 License
