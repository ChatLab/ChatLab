---
outline: deep
---

# 匯入聊天記錄指南

ChatLab 支援多種方式匯入聊天記錄。

## 桌面端：在首頁拖入檔案

這是最簡單的匯入方式：

1. 將聊天平台匯出的**資料檔案**拖入首頁上傳區域。
2. 等待解析和匯入完成。

首頁同時支援增量匯入，如果新檔案與已匯入工作階段能配對，ChatLab 會增量補充新的訊息。

## Agent：使用 AI Skill 匯入

適合已經使用 Codex、Claude Code 等各類 AI Agent，希望讓 Agent 代為執行匯入的使用者。

需要 Node.js 20 或更高版本。安裝 ChatLab CLI 和中文 Skill：

```bash
npm install -g chatlab-cli
npx skills add ChatLab/ChatLab --skill chatlab-import-cn -g
```

然後直接告訴 Agent：

```text
chatlab-import-cn 幫我把 /absolute/path/to/chat-export.json 匯入 ChatLab
```

Agent 會先在背景預覽，預覽成功後自動建立或增量匯入，無需再次確認。

## 終端機：使用命令列匯入

安裝 ChatLab CLI：

```bash
npm install -g chatlab-cli
```

最簡單的用法是直接匯入一個檔案：

```bash
chatlab import "/absolute/path/to/chat-export.json"
```

### 指定現有工作階段

需要明確追加到某個工作階段時，使用 `--session-id`：

```bash
chatlab import "/absolute/path/to/chat-export.json" --session-id <session-id>
```

## 自動化：使用 API 或自動同步

這是適合長期整合的進階方式。首頁的「API 匯入」提供兩個方向：

- **自動同步（Pull）**：ChatLab 定時從已設定的資料來源拉取新增聊天記錄，詳見 [Pull 遠端資料來源協議（簡體中文）](/cn/standard/chatlab-pull)。
- **API 推送（Push）**：第三方工具、外掛程式或腳本透過 ChatLab 本機 API 主動寫入聊天記錄，詳見 [Push 匯入協議（簡體中文）](/cn/standard/chatlab-import)。

## 匯入失敗怎麼辦

在 ChatLab 左下角開啟「設定」→「儲存管理」→「日誌檔案」，然後查看其中的 `import` 目錄。

命令列模式還可以根據 JSON 中的 `error.code` 和 `error.hint` 排查檔案路徑、格式、並行匯入或工作階段 ID 問題。如果仍無法解決，可以攜帶脫敏後的錯誤資訊提交 GitHub Issue。
