<div align="center">

<img src="./public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

Turn messy chat exports into clear, local-first insights.

English | [简体中文](./README.zh-CN.md)

[Official Website](https://chatlab.fun/) · [Documentation](https://chatlab.fun/usage/) · [Roadmap](https://chatlabfun.featurebase.app/roadmap) · [Issue Submission](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab is an open-source web application for understanding your social conversations. It combines a flexible SQL engine with AI agents so you can explore patterns, ask better questions, and extract insights from chat data.

Currently supported: **WhatsApp, LINE, WeChat, QQ, Discord, Instagram, and Telegram**. Coming next: **iMessage, Messenger, and KakaoTalk**.

## Core Features

- 🚀 **Built for large histories**: Stream parsing and multi-worker processing keep imports and analysis responsive, even at million-message scale.
- 🔒 **Private by default**: Your chat data and settings stay on your server. No mandatory cloud upload of raw conversations.
- 🤖 **AI that can actually operate on data**: Agent + Function Calling workflows can search, summarize, and analyze chat records with context.
- 📊 **Insight-rich visual views**: See trends, time patterns, interaction frequency, rankings, and more in one place.
- 🧩 **Cross-platform normalization**: Different export formats are mapped into a unified model so you can analyze them consistently.

## Usage Guides

- [Chat Record Export Guide](https://chatlab.fun/usage/how-to-export.html)
- [Standardized Format Specification](https://chatlab.fun/standard/chatlab-format.html)
- [Troubleshooting Guide](https://chatlab.fun/usage/troubleshooting.html)

## Preview

For more previews, please visit the official website: [chatlab.fun](https://chatlab.fun/)

![Preview Interface](/public/images/intro_en.png)

## System Architecture

### Architecture Principles

- **Local-first by default**: Raw chat data, indexes, and settings remain on the server unless you explicitly choose otherwise.
- **Streaming over buffering**: Stream-first parsing and incremental processing keep large imports stable and memory-efficient.
- **Composable intelligence**: AI features are assembled through Agent + Tool Calling, not hard-coded into one model path.
- **Schema-first evolution**: Import, query, analysis, and visualization share a consistent data model that scales with new features.

### Runtime Architecture

- **Backend (API + Data Layer)**: `server/index.ts` provides an Express 5 API server with RESTful endpoints for all data operations. SQLite databases are managed server-side via better-sqlite3. Routes are organized by domain in `server/routes/`.
- **Frontend (Interaction Layer)**: Vue 3 + Nuxt UI + Tailwind CSS drive management, chat, and analysis interfaces. The frontend communicates with the backend via HTTP API calls through the `src/services/` client layer.
- **Dev Mode**: Vite dev server (port 3400) proxies `/api` requests to Express (port 3001). Both start with a single `pnpm dev` command.
- **Production Mode**: Express serves the built Vite client as static files and handles API requests from a single process.

### Data Pipeline

1. **Ingestion**: `parser/` detects file format and dispatches to the matching parser module.
2. **Persistence**: Stream-based writes populate core local entities: sessions, members, and messages.
3. **Indexing**: Session- and time-oriented indexes are built for timeline navigation and retrieval.
4. **Query & Analysis**: Server-side query services power activity metrics, interaction analysis, SQL Lab, and AI-assisted exploration.
5. **Presentation**: The frontend turns query output into charts, rankings, timelines, and conversational analysis flows.

### Extensibility & Reliability

- **Pluggable parser architecture**: Adding a new import source is mostly an extension in `parser/formats/*`, without reworking downstream query logic.
- **Full + incremental import paths**: `streamImport.ts` and `incrementalImport.ts` support both first-time onboarding and ongoing updates.
- **Modular API boundaries**: Domain-based route segmentation reduces cross-layer coupling and limits permission spread.
- **Unified i18n evolution**: The i18n system can evolve with product scope.

---

## Local Development

### Requirements

- Node.js >= 20
- pnpm

### Setup

```bash
# install dependencies
pnpm install

# run web app in dev mode (starts Express API server + Vite dev server)
pnpm dev
```

The Vite dev server runs on port 3400 and proxies `/api` requests to the Express backend on port 3001.

### Common Scripts

```bash
# type checks (web + server)
pnpm type-check:all

# type check web only
pnpm type-check:web

# type check server only
pnpm type-check:server

# lint and auto-fix
pnpm lint

# format files
pnpm format

# build for production (typechecks server + builds Vite client)
pnpm build

# run tests
pnpm test

# start production server (serves API + built client from one process)
pnpm start
```

### Production Deployment

```bash
# Build the application
pnpm build

# Start the production server
pnpm start
```

The production server runs on port 3001 (configurable via `PORT` environment variable). It serves the Vite-built client as static files and handles all `/api/*` routes.

## Contributing

Please follow these principles before submitting a Pull Request:

- Obvious bug fixes can be submitted directly.
- For new features, please submit an Issue for discussion first; **PRs submitted without prior discussion will be closed**.
- Keep one PR focused on one task; if changes are extensive, consider splitting them into multiple independent PRs.

## Privacy Policy & User Agreement

Before using this software, please read the [Privacy Policy & User Agreement](./src/assets/docs/agreement_en.md).

## License

AGPL-3.0 License
