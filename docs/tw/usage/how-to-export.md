---
outline: deep
---

# 匯出聊天記錄

ChatLab 專注於對已匯出數據的分析，我們不提供抓取數據的功能。您需要先使用官方功能或開源社群的第三方工具，將聊天記錄匯出後，再匯入 ChatLab 進行分析。

Tips：歡迎訪問 [加入社群](https://chatlab.fun/tw/other/community)，討論問題以及溝通需求。

## WhatsApp

對於 WhatsApp， 目前已適配官方提供的”匯出聊天”功能。

目前已相容中文語言和英文語言的匯出，如有其他語言需求，請聯繫開發者。

- **匯出方式**：
  1. 打開 WhatsApp，進入想要匯出的對話。
  2. 點擊頂部聯絡人名稱 -> 匯出聊天 (Export Chat)。
  3. 選擇”不附加媒體”。
- **格式**：將匯出後的 `.zip` 包解壓出其中的 `txt` 檔案，將 `txt` 檔案拖入 ChatLab 即可。

## Discord

對於 Discord，目前已適配 **DiscordChatExporter** 匯出的 json 格式。

- **項目地址**：[https://github.com/Tyrrrz/DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter)
- **支援平台**：Windows / macOS / Linux
- **使用教程**：參考項目 README。
- **提示**：請務必選擇匯出格式為 **JSON**，以便 ChatLab 正確解析。

## Instagram

對於 Instagram，目前已適配官方提供的匯出功能。

- **匯出方式**：
  1. 打開 Instagram 應用或網頁版，進入「設定」。
  2. 點擊「帳戶中心」->「你的資訊和權限」->「下載你的資訊」。
  3. 選擇「部分資訊」，然後勾選「訊息」。
  4. 選擇格式為 **JSON**，日期範圍選擇「所有時間」。
  5. 點擊「提交請求」，等待 Instagram 處理完成後下載。
- **格式**：將下載的壓縮包解壓後，找到 `your_instagram_activity/messages/inbox/` 目錄下對應聊天的 `message_1.json` 檔案，拖入 ChatLab 即可。
- **提示**：如果對話內容較多，可能會有多個 `message_*.json` 檔案，建議逐一匯入。

## LINE

對於 LINE，目前已適配官方提供的聊天記錄匯出功能。

- **匯出方式**：
  1. 打開 LINE，進入想要匯出的對話。
  2. 移動端：點擊聊天右上角選單 -> 設定 -> 匯出聊天記錄。
  3. 桌面端（Windows / macOS）：進入 Chats，打開對應聊天後，點擊右上角選單 -> Save chat。
  4. 保存或分享匯出的文本檔案。
- **格式**：將匯出的 `.txt` 檔案直接拖入 ChatLab 即可。
- **提示**：LINE 官方說明中提到，桌面端僅會保存當前已加載並顯示在聊天視窗中的訊息。

## iMessage

對於 iMessage，目前 **imessage-chatlab** 已適配 ChatLab 標準 JSON 格式。

- **項目地址**：[https://github.com/gamesme/imessage-chatlab](https://github.com/gamesme/imessage-chatlab)
- **支援平台**：macOS
- **安裝方式**：如果已安裝 Rust 工具鏈，可以執行 `cargo install imessage-chatlab`；也可以依照項目 README 從源碼安裝。
- **匯出方式**：參考項目 README。例如可執行 `imessage-chatlab -c clone -o ~/imessage_chatlab_export` 匯出本機 iMessage 數據。
- **格式**：工具會按會話匯出 ChatLab 標準 JSON 檔案，將匯出的 `.json` 檔案拖入 ChatLab 即可。
- **提示**：該工具會讀取 macOS 本機 Messages 資料庫。使用前請仔細閱讀項目文件，並確認您擁有讀取與分析相關聊天記錄的合法權限。

## Google Chat

對於 Google Chat，目前已適配 Google 官方 Takeout 匯出的 ZIP 格式。

- **匯出方式**：
  1. 前往 [Google Takeout](https://takeout.google.com/)，以您的 Google 帳號登入。
  2. 點擊「取消全選」，再單獨勾選 **Google Chat**（可縮小匯出體積）。
  3. 選擇檔案類型為 **.zip**（暫不支援 .tgz 格式）。
  4. 點擊「建立匯出」，等待 Google 處理完成後下載（系統會寄送電子郵件通知）。
- **格式**：將下載的 `.zip` 檔案直接拖入 ChatLab，ChatLab 會掃描壓縮包內所有對話並顯示選擇清單，勾選後逐一匯入即可。
- **提示**：
  - 僅支援 ZIP 格式，若 Takeout 提供的是 .tgz，請重新匯出時選擇 .zip。
  - 首次匯出請求可能需要等候數小時。
  - 附件（圖片、檔案等）目前不會隨聊天記錄一併匯入。

## Q&A：飛書/企微/千牛等的聊天記錄能分析嗎？

針對各種聊天分析的需求，統一回覆：

ChatLab 的功能是 **對已匯出的固定文本格式的聊天記錄進行分析**，但前提是**您已經透過合法合規的管道匯出了聊天記錄**。

如果您有一定的技術基礎，可以嘗試使用 **AI 輔助轉換** 的方式，將您的數據轉換為標準格式。詳情請查看 [AI 輔助轉換指南](/tw/standard/ai-converter)。

此外，如果您是開發者，並已支援了其他聊天應用的聊天記錄匯出，歡迎[相容 ChatLab 格式](/tw/standard/chatlab-format)，我會將您的 Github 連結加到這裡。

## ⚠️ 法律與安全聲明

在嘗試分析上述應用的數據前，請務必知曉：

- **合法授權原則**：您僅可處理您**本人參與**的聊天記錄。若涉及他人隱私，請務必確保已獲得相關人員的知情同意。
- **禁止非法用途**：嚴禁將本軟體用於竊取、監控或分析未經授權的他人隱私，或用於任何侵犯他人權益的行為。
- **合規性自負**：從第三方平台取得數據的行為屬於您的個人行為。若因分析行為違反了原始數據來源平台的服務條款而導致帳號受限或其他後果，ChatLab 不承擔任何責任。
- **禁止商用**：嚴禁任何個人或機構將本軟體或分析結果用於任何形式的商業盈利行為。
- **結果準確性**：軟體生成的分析結果可能存在錯誤或”幻覺”，僅供技術交流參考，不應作為法律證據或決策依據。
