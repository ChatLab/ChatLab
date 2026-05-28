---
outline: deep
---

# 快速上手

## 第一步：安裝 ChatLab

ChatLab 提供兩種安裝方式：

**方式一：官網下載安裝包**

前往 [ChatLab 官網](https://chatlab.fun) 下載對應作業系統的安裝包，雙擊安裝即可。也可以從 [GitHub Releases](https://github.com/ChatLab/ChatLab/releases) 下載。

**方式二：CLI 安裝**

```bash
npm i chatlab-cli -g
```

需要 Node.js ≥ 20。CLI 適合伺服器部署或搭配 AI Agent（如 Claude Desktop）使用。

## 第二步：匯入聊天記錄

ChatLab 提供三種匯入方式，適用於不同場景：

| 方式 | 適用場景 |
|------|----------|
| **檔案匯入** | 將匯出的聊天記錄檔案直接拖入 ChatLab 首頁，適合一次性匯入 |
| **自動同步** | 設定外部平台的資料來源，讓聊天記錄定期自動同步到 ChatLab |
| **API 匯入** | 開啟本機 API 服務，允許第三方工具/外掛或腳本主動推送聊天記錄至 ChatLab |

### 普通使用者

使用**檔案匯入**即可，你需要：

1. 先使用第三方工具將聊天記錄匯出為檔案，具體匯出方式請查看 [匯出聊天記錄](/tw/usage/how-to-export)。
2. 將匯出的檔案直接拖入 ChatLab 首頁即可，如遇問題請查看 [匯入聊天記錄指南](/tw/usage/how-to-import)。

### 開發者

如果你是開發者，想要對接**自動同步**或 **API 匯入**，請查看以下文件：

- [ChatLab Format](/tw/standard/chatlab-format) — 了解資料格式規範

## 第三步：配置 AI

ChatLab 內建 AI Agent 功能，接入 AI 模型後即可透過自然語言探索你的聊天歷史。

詳細配置步驟請查看 [如何配置 AI 模型](/tw/usage/how-to-config-ai)。
