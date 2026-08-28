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

Common options: `--port <port>` (default `3110`), `--host <address>`, and `--token <token>`. On macOS and Linux, use `--socket <path>` to listen on a Unix domain socket instead of a TCP port, for example `clb web --socket /tmp/chatlab.sock --no-open`. Access it with `curl --unix-socket /tmp/chatlab.sock -H "Authorization: Bearer YOUR_TOKEN" http://localhost/api/v1/status` (replace `YOUR_TOKEN` with the token printed at startup) or place a reverse proxy in front of it.

If the reverse proxy runs as a different Unix user, give its group access to the socket after ChatLab starts: `sudo chgrp <proxy-group> /tmp/chatlab.sock && sudo chmod 660 /tmp/chatlab.sock`. Reapply this after each restart, preferably with a service-manager post-start hook. No permission change is normally needed when ChatLab and the proxy run as the same user.

If the proxy is accessible beyond the local trusted machine, start ChatLab with `--require-auth` (or enforce authentication at the proxy) so the Web UI routes and token configuration are not public.

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
