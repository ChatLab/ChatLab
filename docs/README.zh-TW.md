<div align="center">

<img src="../public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

在本機分析聊天記錄，透過 AI Agent 重新看見你的社交記憶

[English](../README.md) | [简体中文](./README.zh-CN.md) | 繁體中文 | [日本語](./README.ja-JP.md)

[官網](https://chatlab.fun/tw/) · [下載指南](https://chatlab.fun/tw/?type=download) · [使用文件](https://chatlab.fun/tw/usage/) · [Roadmap](https://chatlabfun.featurebase.app/roadmap) · [問題回報](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab 是一款專注於社交記錄分析的本機應用。結合 AI Agent 與靈活的 SQL 引擎，你可以更自由地拆解、查詢，甚至重新理解自己的聊天資料。

目前已支援：WhatsApp、LINE、QQ、Discord、Instagram、Telegram 的聊天記錄分析；即將支援：iMessage、Messenger、KakaoTalk。

## 核心特色

- 🚀 **高效處理大型資料**：採用串流計算與多執行緒架構，就算是百萬筆聊天記錄，依然能保持流暢的匯入與分析體驗。
- 🔒 **預設重視隱私**：聊天記錄與設定都保留在本機，分析流程也以本地執行為主（AI 功能除外）。
- 🤖 **可實際操作資料的 AI Agent**：內建 10+ 個 Function Calling 工具，可依任務動態調度，深入挖掘聊天脈絡與重點。
- 📊 **多維度視覺化分析**：提供活躍度趨勢、時段分布、成員排行等多種圖表與分析視角。
- 🧩 **統一資料格式**：透過穩定的資料抽象層，抹平不同聊天平台的匯出差異，分析流程更一致。

## 使用指南

- [下載 ChatLab 指南](https://chatlab.fun/tw/?type=download)
- [匯出聊天記錄指南](https://chatlab.fun/tw/usage/how-to-export.html)
- [標準化格式規範](https://chatlab.fun/tw/standard/chatlab-format.html)
- [疑難排解指南](https://chatlab.fun/tw/usage/troubleshooting.html)

## 預覽畫面

更多畫面請前往官網 [chatlab.fun](https://chatlab.fun/tw/)

![預覽畫面](../public/images/intro_zh.png)

## 系統架構

### 架構原則（Architecture Principles）

- **Local-first by default**：原始聊天記錄、索引與設定預設留在本機，優先守住隱私邊界。
- **Streaming over buffering**：以串流解析與增量處理為核心，在大型匯出檔案下依然維持穩定吞吐。
- **Composable intelligence**：AI 能力透過 Agent + Tool Calling 組合，不把業務邏輯硬寫死在單一路徑。
- **Schema-first evolution**：圍繞統一資料模型設計匯入、查詢、分析與視覺化，降低後續演進成本。

### 執行期架構（Runtime Architecture）

- **Main Process（控制層）**：`electron/main/index.ts` 負責生命週期與視窗；`electron/main/ipc/` 提供分域 IPC；`electron/main/ai/` 與 `electron/main/i18n/` 提供 AI 與國際化基礎能力。
- **Worker Layer（計算層）**：`electron/main/worker/` 透過 `workerManager` 調度任務，隔離匯入、索引與查詢等高負載工作，降低 UI 阻塞風險。
- **Renderer Layer（互動層）**：基於 Vue 3 + Nuxt UI + Tailwind CSS，承載管理、私聊、群聊與分析視圖；透過 `electron/preload/index.ts` 暴露受控 API，確保渲染層與主進程隔離。

### 資料流程（Data Pipeline）

1. **匯入接入**：`parser/` 先偵測格式，再交由對應解析器執行標準化轉換。
2. **資料落盤**：以串流方式寫入本機資料庫，建立會話、成員、訊息等核心實體。
3. **索引建立**：依據會話與時間維度建立分析索引，支撐時間線與檢索能力。
4. **查詢與分析**：`worker/query/*` 提供活躍度、互動關係、SQL Lab 與 AI 檢索等查詢能力。
5. **結果呈現**：渲染層把查詢結果轉成圖表、排行、時間線與對話式分析體驗。

## 本機開發

### 環境需求

- Node.js >= 20
- pnpm

### 啟動方式

```bash
# 安裝依賴
pnpm install

# 啟動開發模式
pnpm dev
```

若 Electron 啟動時發生異常，可嘗試使用 `electron-fix`：

```bash
npm install electron-fix -g
electron-fix start
```

## 隱私權政策與使用者協議

使用本軟體前，請先閱讀 [隱私權政策與使用者協議](../src/assets/docs/agreement_zh_tw.md)

## 社群

提交 Pull Request 前請遵循以下原則：

- 明顯的 Bug 修復可直接提交
- 新功能請先提交 Issue 討論，**未經討論直接提交的 PR 會被關閉**
- 一個 PR 盡量只處理一件事；若改動較大，建議拆分成多個獨立 PR

感謝所有為 ChatLab 做出貢獻的人！

<a href="https://github.com/hellodigua/ChatLab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hellodigua/ChatLab" />
</a>

## License

AGPL-3.0 License
