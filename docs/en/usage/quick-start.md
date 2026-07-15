---
outline: deep
---

# Quick Start

## Step 1: Install ChatLab

There are two ways to install ChatLab:

**Option 1: Download from the website**

Go to the [ChatLab website](https://chatlab.fun) or [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) to download the installer for your operating system, then run it.

**Option 2: CLI**

```bash
npm i chatlab-cli -g
```

Requires Node.js ≥ 20.

After installation, start ChatLab with:

```bash
chatlab start             # Start API + Web UI and open in browser
chatlab start --no-open   # Start API + Web UI without auto-opening the browser
chatlab start --headless  # API-only mode, no Web UI (for scripts / AI Agents)
```

Common options: `--port <port>` (default 3110), `--host <address>`, `--token <token>`.

To keep ChatLab running persistently (auto-start on login), add the `--daemon` flag:

```bash
chatlab start --daemon   # Install as a system service (macOS / Linux)
chatlab status           # Check service status
chatlab stop             # Stop and remove the service
```

::: tip
`clb` is a shorthand alias for `chatlab` — both are equivalent.
:::

## Step 2: Import chat records

ChatLab supports three ways to bring in your chat records:

| Method | When to use |
|--------|-------------|
| **File import** | Drag an exported file straight into the ChatLab home screen — the simplest option for most users |
| **Auto sync** | Connect an external data source and let ChatLab sync new messages on a schedule |
| **API push** | Open ChatLab's local API so external tools or scripts can push records in directly |

### Regular users

Use **file import** — you need to:

1. Export your chat records using a third-party tool. See [Export Chat Records](/usage/how-to-export) for details.
2. Drag the exported files into the ChatLab homepage. If you run into issues, see [Import Chat Records Guide](/usage/how-to-import).

### Developers

If you're a developer looking to integrate **auto sync** or **API push**, see:

- [ChatLab Format](/standard/chatlab-format) — understand the data format specification

## Step 3: Configure AI

ChatLab comes with a built-in AI Agent. Connect a model and start asking questions about your chat history in natural language.

See [Analyze with built-in AI](/ai/chatlab-ai) for detailed setup steps.
