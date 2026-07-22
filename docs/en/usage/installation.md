---
outline: deep
---

# Install ChatLab

ChatLab is available as a Desktop app, CLI, or Docker image.

## Desktop

Download the installer for your operating system from the [ChatLab website](https://chatlab.fun) or [GitHub Releases](https://github.com/ChatLab/ChatLab/releases), then run it.

## CLI

The CLI requires Node.js 20 or newer:

```bash
npm install --global chatlab-cli
```

After installation, run:

```bash
chatlab start             # Start API + Web UI and open it in a browser
chatlab start --no-open   # Start API + Web UI without opening a browser
chatlab start --headless  # Start the API without serving the Web UI (for scripts / AI Agents)
```

Common options: `--port <port>` (default `3110`), `--host <address>`, and `--token <token>`.

To keep ChatLab running as a background service:

```bash
chatlab start --daemon  # Install as a system service (macOS / Linux)
chatlab status          # Check service status
chatlab stop            # Stop and remove the service
```

::: tip
`clb` is a shorthand alias for `chatlab`; both are equivalent.
:::

## Docker

For a container deployment, see [Docker Deployment](/usage/docker). To share data later with Desktop or a local CLI on the same computer, use the recommended host-directory mount.

After installation, continue with [Quick Start](/usage/quick-start).
