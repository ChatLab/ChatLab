---
outline: deep
---

# 快速上手

尚未安裝時，請先查看 [安裝 ChatLab](/tw/usage/installation) 或 [Docker 部署](/tw/usage/docker)。

## 第一步：匯入聊天記錄

ChatLab 提供三種匯入方式，適用於不同場景：

| 方式 | 適用場景 |
|------|----------|
| **檔案匯入** | 將匯出的聊天記錄檔案直接拖入 ChatLab 首頁，適合一次性匯入 |
| **自動同步** | 設定外部平台的資料來源，讓聊天記錄定期自動同步到 ChatLab |
| **API 推送** | 開啟本機 API 服務，允許第三方工具/外掛或腳本主動推送聊天記錄至 ChatLab |

### 普通使用者

使用**檔案匯入**即可，你需要：

1. 先使用第三方工具將聊天記錄匯出為檔案，具體匯出方式請查看 [匯出聊天記錄](/tw/usage/how-to-export)。
2. 將匯出的檔案直接拖入 ChatLab 首頁即可，如遇問題請查看 [匯入聊天記錄指南](/tw/usage/how-to-import)。

### 開發者

如果你是開發者，想要對接**自動同步**或 **API 推送**，請查看以下文件：

- [ChatLab Format](/tw/standard/chatlab-format) — 了解資料格式規範

## 第二步：設定 AI

ChatLab 內建 AI Agent 功能，接入 AI 模型後即可透過自然語言探索你的聊天歷史。

進一步了解 ChatLab 如何使用 AI 分析聊天記錄，請查看 [為什麼選擇 ChatLab](/tw/ai/why-chatlab)。
