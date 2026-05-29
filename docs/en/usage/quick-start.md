---
outline: deep
---

# Quick Start

## Step 1: Install ChatLab

ChatLab offers two ways to install:

**Option 1: Download from the website**

Go to the [ChatLab website](https://chatlab.fun) to download the installer for your operating system, then run it. You can also download from [GitHub Releases](https://github.com/ChatLab/ChatLab/releases).

**Option 2: CLI**

```bash
npm i chatlab-cli -g
```

Requires Node.js ≥ 20. The CLI is suited for server-side deployments or pairing with an AI Agent (e.g., Claude Desktop).

After installation, start ChatLab with:

```bash
chatlab start             # Start API + Web UI and open in browser
chatlab start --no-open   # Start API + Web UI without auto-opening the browser
chatlab start --headless  # API-only mode, no Web UI (for scripts / AI Agents)
```

Common options: `--port <port>` (default 3110), `--host <address>`, `--token <token>`.

To keep ChatLab running persistently (auto-start on login + crash recovery), add the `--daemon` flag:

```bash
chatlab start --daemon   # Install as a system service (macOS / Linux)
chatlab status           # Check service status
chatlab stop             # Stop and remove the service
```

## Step 2: Import chat records

ChatLab provides three import methods for different scenarios:

| Method | Use case |
|--------|----------|
| **File import** | Drag exported chat record files directly into the ChatLab homepage — ideal for one-time imports |
| **Auto sync** | Configure external platform data sources for periodic automatic sync to ChatLab |
| **API import** | Enable the local API service to let third-party tools/plugins/scripts push chat records to ChatLab |

### Regular users

Use **file import** — you need to:

1. Export your chat records using a third-party tool. See [Export Chat Records](/usage/how-to-export) for details.
2. Drag the exported files into the ChatLab homepage. If you run into issues, see [Import Chat Records Guide](/usage/how-to-import).

### Developers

If you're a developer looking to integrate **auto sync** or **API import**, see:

- [ChatLab Format](/standard/chatlab-format) — understand the data format specification

## Step 3: Configure AI

ChatLab has a built-in AI Agent feature. Connect an AI model to explore your chat history using natural language.

See [How to Configure AI](/usage/how-to-config-ai) for detailed setup steps.
