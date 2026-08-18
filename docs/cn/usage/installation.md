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

常用选项：`--port <端口>`（默认 `3110`）、`--host <地址>`、`--token <令牌>`。

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
