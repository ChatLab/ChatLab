---
outline: deep
---

# 安裝 ChatLab

ChatLab 提供 Desktop、CLI 和 Docker 三種安裝方式。

## Desktop

前往 [ChatLab 官網](https://chatlab.fun) 或 [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) 下載對應作業系統的安裝程式，執行安裝即可。

## CLI

CLI 需要 Node.js 20 或更新版本：

```bash
npm install --global chatlab-cli
```

安裝完成後執行：

```bash
chatlab start             # 啟動 API + Web UI，並在瀏覽器中開啟
chatlab start --no-open   # 啟動 API + Web UI，但不自動開啟瀏覽器
chatlab start --headless  # 僅啟動 API，不提供 Web UI（供腳本 / AI Agent 呼叫）
```

常用選項：`--port <連接埠>`（預設 `3110`）、`--host <位址>`、`--token <令牌>`。

若要讓服務常駐後台，可以使用：

```bash
chatlab start --daemon  # 註冊為系統服務，登入時自動啟動（macOS / Linux）
chatlab status          # 查看常駐狀態
chatlab stop            # 停止並移除系統服務
```

::: tip
`clb` 是 `chatlab` 的簡寫，兩者完全相同。
:::

## Docker

需要容器部署時，請查看 [Docker 部署](/tw/usage/docker)。如果希望日後與同一台電腦上的 Desktop 或本機 CLI 共用資料，請使用其中建議的主機目錄掛載方式。

安裝完成後，繼續閱讀 [快速開始](/tw/usage/quick-start)。
