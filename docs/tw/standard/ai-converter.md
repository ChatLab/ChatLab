---
outline: deep
---

# 使用 AI 轉換聊天記錄

如果 ChatLab 還不能直接識別你的聊天記錄，可以讓本機 Agent 使用官方轉換 Skill 分析檔案結構、編寫轉換腳本，並將記錄轉成 [ChatLab 標準格式](./chatlab-format.md)。

轉換過程在本機執行。Skill 只允許 Agent 讀取必要的結構資訊，不會在終端輸出完整聊天正文，也不會修改來源檔案。

## 準備工具

先安裝 ChatLab CLI：

```bash
npm install -g chatlab-cli
```

再於支援 Skills 的 Agent 環境安裝中文版轉換 Skill：

```bash
npx skills add ChatLab/ChatLab --skill chatlab-convert-cn -g
```

## 開始轉換

把聊天匯出的準確路徑告訴 Agent：

```text
使用 $chatlab-convert-cn，把「/你的/聊天記錄路徑」轉換並匯入 ChatLab。
```

如果只希望產生轉換結果，不立即匯入：

```text
使用 $chatlab-convert-cn，把「/你的/聊天記錄路徑」轉換為 ChatLab 格式，只轉換，不匯入。
```

Skill 會自動選擇電腦上已有的 Node.js、Python 或 Shell 工具，完成以下流程：

1. 先確認 ChatLab 是否已經支援該格式；
2. 只提取欄位、類型、數量等必要結構，避免輸出聊天正文；
3. 確認成員、時間、會話邊界和訊息類型的映射；
4. 編寫並執行可重複使用的本機轉換腳本；
5. 預設產生適合大型檔案串流處理的 JSONL；
6. 嚴格驗證格式和記錄數量，再執行 ChatLab 匯入預覽；
7. 只有你明確要求匯入時，才會正式寫入 ChatLab。

如果一個來源檔案包含多個會話，Skill 會分別產生多個檔案，不會把它們誤合併。

## 如何判斷轉換成功

轉換完成前，Agent 必須依序執行：

```bash
chatlab validate "/轉換後的檔案.jsonl" --json
chatlab import "/轉換後的檔案.jsonl" --dry-run --json
```

只有嚴格驗證和匯入預覽都成功，而且來源訊息數與輸出訊息數核對一致，才會回報轉換成功。轉換腳本和輸出檔案都會保留，方便之後重新轉換更新後的聊天記錄。

::: warning 隱私提醒
請使用能存取本機檔案和終端的 Agent 執行轉換，不要把完整聊天檔案上傳到線上對話框。即使需要排查特殊文字格式，也應只檢查最小範圍並隱藏訊息正文。
:::
