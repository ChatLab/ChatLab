---
outline: deep
---

# 安装 ChatLab

ChatLab 提供 Desktop、CLI 和 Docker 三种安装方式。

## Desktop

前往 [ChatLab 官网](https://chatlab.fun) 或 [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) 下载对应操作系统的安装包，双击安装即可。

macOS Desktop 目前仅支持搭载 Apple 芯片（M 系列）的 Mac。Intel Mac 用户可以使用下方的 CLI Web。

## CLI

CLI 需要 Node.js 22.19 或更高版本：

```bash
npm install --global chatlab-cli
```

安装后运行：

```bash
clb web             # 启动 API + Web UI，并在浏览器中打开
clb web --no-open   # 启动 API + Web UI，但不自动打开浏览器
clb web --headless  # 仅启动 API，不提供 Web UI（供脚本 / AI Agent 调用）
```

常用选项：`--port <端口>`（默认 `3110`）、`--host <地址>`、`--token <令牌>`。在 macOS 和 Linux 上，可以使用 `--socket <路径>` 监听 Unix 域套接字而不占用 TCP 端口，例如 `clb web --socket /tmp/chatlab.sock --no-open`。可通过 `curl --unix-socket /tmp/chatlab.sock -H "Authorization: Bearer YOUR_TOKEN" http://localhost/api/v1/status` 访问（将 `YOUR_TOKEN` 替换为启动时显示的令牌），或在其前面配置反向代理。

如果反向代理以另一个 Unix 用户运行，请在 ChatLab 启动后为代理所属组授予套接字访问权限：`sudo chgrp <代理组> /tmp/chatlab.sock && sudo chmod 660 /tmp/chatlab.sock`。每次重启后都需要重新应用，建议使用服务管理器的启动后钩子。ChatLab 与代理以同一用户运行时通常无需修改权限。

如果代理可从本机可信环境之外访问，请使用 `--require-auth` 启动 ChatLab（或在代理层强制身份验证），避免 Web UI 路由和令牌配置公开暴露。

如果希望服务常驻后台，可以使用：

```bash
clb web --daemon  # 注册为系统服务，开机自启（macOS / Linux）
clb status          # 查看常驻状态
clb stop            # 停止并取消常驻
```

::: tip
推荐使用 `clb`。旧的 `chatlab` 命令仍会保留，以兼容已有脚本和使用习惯。
:::

## Docker

需要容器部署时，请查看 [Docker 部署](/cn/usage/docker)。如果希望以后与同一台电脑上的 Desktop 或本地 CLI 共用数据，请使用其中推荐的宿主机目录挂载方式。

安装完成后，继续阅读 [快速开始](/cn/usage/quick-start)。
