---
outline: deep
---

# 安裝 ChatLab

ChatLab 提供 Desktop、CLI 和 Docker 三種安裝方式。

## Desktop

前往 [ChatLab 官網](https://chatlab.fun) 或 [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) 下載對應作業系統的安裝程式，執行安裝即可。

macOS Desktop 目前僅支援搭載 Apple 晶片（M 系列）的 Mac。Intel Mac 使用者可以改用下方的 CLI Web。

## CLI

CLI 需要 Node.js 22.19 或更新版本：

```bash
npm install --global chatlab-cli
```

安裝完成後執行：

```bash
clb web             # 啟動 API + Web UI，並在瀏覽器中開啟
clb web --no-open   # 啟動 API + Web UI，但不自動開啟瀏覽器
clb web --headless  # 僅啟動 API，不提供 Web UI（供腳本 / AI Agent 呼叫）
```

常用選項：`--port <連接埠>`（預設 `3110`）、`--host <位址>`、`--token <令牌>`。在 macOS 和 Linux 上，可以使用 `--socket <路徑>` 監聽 Unix 網域通訊端而不占用 TCP 連接埠，例如 `clb web --socket /tmp/chatlab.sock --no-open`。可透過 `curl --unix-socket /tmp/chatlab.sock -H "Authorization: Bearer YOUR_TOKEN" http://localhost/api/v1/status` 存取（請將 `YOUR_TOKEN` 替換為啟動時顯示的令牌），或在其前方設定反向代理。

如果反向代理以另一個 Unix 使用者執行，請在 ChatLab 啟動後為代理所屬群組授予通訊端存取權限：`sudo chgrp <代理群組> /tmp/chatlab.sock && sudo chmod 660 /tmp/chatlab.sock`。每次重新啟動後都需要再次套用，建議使用服務管理器的啟動後掛鉤。ChatLab 與代理以相同使用者執行時通常不需要修改權限。

如果代理可從本機信任環境之外存取，請使用 `--require-auth` 啟動 ChatLab（或在代理層強制驗證身分），避免 Web UI 路由和權杖設定公開暴露。

若要讓服務常駐後台，可以使用：

```bash
clb web --daemon  # 註冊為系統服務，登入時自動啟動（macOS / Linux）
clb status          # 查看常駐狀態
clb stop            # 停止並移除系統服務
```

::: tip
建議使用 `clb`。舊的 `chatlab` 指令仍會保留，以相容既有腳本與使用習慣。
:::

## Docker

需要容器部署時，請查看 [Docker 部署](/tw/usage/docker)。如果希望日後與同一台電腦上的 Desktop 或本機 CLI 共用資料，請使用其中建議的主機目錄掛載方式。

安裝完成後，繼續閱讀 [快速開始](/tw/usage/quick-start)。
