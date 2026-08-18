---
outline: deep
---

# Install ChatLab

ChatLab is available as a Desktop app, CLI, or Docker image.

## Desktop

Download the installer for your operating system from the [ChatLab website](https://chatlab.fun) or [GitHub Releases](https://github.com/ChatLab/ChatLab/releases), then run it.

The macOS Desktop app currently supports Apple Silicon Macs only. Intel Mac users can use CLI Web below.

## CLI

The CLI requires Node.js 22.19 or newer:

```bash
npm install --global chatlab-cli
```

After installation, run:

```bash
clb web             # Start API + Web UI and open it in a browser
clb web --no-open   # Start API + Web UI without opening a browser
clb web --headless  # Start the API without serving the Web UI (for scripts / AI Agents)
```

Common options: `--port <port>` (default `3110`), `--host <address>`, and `--token <token>`.

To keep ChatLab running as a background service:

```bash
clb web --daemon  # Install as a system service (macOS / Linux)
clb status          # Check service status
clb stop            # Stop and remove the service
```

::: tip
`clb` is the recommended command. The legacy `chatlab` command remains available for compatibility.
:::

## Docker

For a container deployment, see [Docker Deployment](/usage/docker). To share data later with Desktop or a local CLI on the same computer, use the recommended host-directory mount.

After installation, continue with [Quick Start](/usage/quick-start).
