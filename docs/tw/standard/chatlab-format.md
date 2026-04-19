---
outline: deep
---

# 聊天資料交換標準化格式

> v0.0.2

ChatLab 定義了一套標準的聊天記錄資料交換格式，用於支援多平台資料的統一匯入和分析。

只要你將聊天記錄轉為該格式，那麼就可以被 ChatLab 解析並使用其分析能力。

::: warning 注意
該格式規範目前仍處於早期制定階段，部分欄位和結構可能會在後續版本中調整。
:::

## 概述

### 支援的檔案格式

| 格式      | 副檔名   | 適用場景                                            |
| --------- | -------- | --------------------------------------------------- |
| **JSON**  | `.json`  | 中小型記錄（<100 萬條），結構清晰，易於閱讀         |
| **JSONL** | `.jsonl` | 超大規模記錄（>100 萬條），流式處理，記憶體佔用恆定 |

### 格式對比

| 特性         | JSON                   | JSONL                   |
| ------------ | ---------------------- | ----------------------- |
| 記憶體佔用   | 需載入完整結構         | 逐行處理，恆定 (~100MB) |
| 檔案大小限制 | ~1GB（取決於記憶體）   | 無實際限制              |
| 追加寫入     | - 需重寫整個檔案       | ✅ 直接追加行           |
| 錯誤復原     | 單處錯誤整檔案失效     | 可跳過錯誤行繼續        |
| 可讀性       | ⭐⭐⭐ 易於閱讀        | ⭐⭐ 每行一條記錄       |
| 推薦場景     | 小中型記錄 (<100 萬條) | 大型記錄 (>100 萬條)    |

## 快速說明

以下是一個**最小化**的 ChatLab 格式範例，只包含必要欄位：

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1703001600
  },
  "meta": {
    "name": "我的群聊",
    "platform": "qq",
    "type": "group"
  },
  "members": [
    {
      "platformId": "123456",
      "accountName": "張三"
    }
  ],
  "messages": [
    {
      "sender": "123456",
      "accountName": "張三",
      "timestamp": 1703001600,
      "type": 0,
      "content": "大家好！"
    }
  ]
}
```

---

## JSON 格式詳細說明

### 檔案頭 (chatlab)

| 欄位          | 類型   | 必填 | 說明                         |
| ------------- | ------ | ---- | ---------------------------- |
| `version`     | string | ✅   | 格式版本號，目前為 `"0.0.2"` |
| `exportedAt`  | number | ✅   | 匯出時間（秒級 Unix 時間戳） |
| `generator`   | string | -    | 產生工具名稱                 |
| `description` | string | -    | 描述資訊                     |

### 元資訊 (meta)

| 欄位          | 類型   | 必填 | 說明                                                     |
| ------------- | ------ | ---- | -------------------------------------------------------- |
| `name`        | string | ✅   | 群名或對話名                                             |
| `platform`    | string | ✅   | 平台標識，如 `qq` / `wechat` / `discord` / `whatsapp` 等 |
| `type`        | string | ✅   | 聊天類型：`group`（群聊）/ `private`（私聊）             |
| `groupId`     | string | -    | 群 ID（僅群聊）                                          |
| `groupAvatar` | string | -    | 群頭像（Data URL 格式）                                  |
| `ownerId`     | string | -    | 所有者/匯出者的 platformId                               |

### 成員 (members)

| 欄位            | 類型         | 必填 | 說明                        |
| --------------- | ------------ | ---- | --------------------------- |
| `platformId`    | string       | ✅   | 使用者唯一標識              |
| `accountName`   | string       | ✅   | 帳號名稱                    |
| `groupNickname` | string       | -    | 群暱稱（僅群聊）            |
| `aliases`       | string[]     | -    | 使用者自訂別名              |
| `avatar`        | string       | -    | 使用者頭像（Data URL 格式） |
| `roles`         | MemberRole[] | -    | 成員角色（可多個）          |

#### 角色 (roles)

成員可以擁有一個或多個角色，用於標示群主、管理員等身份：

| 欄位   | 類型   | 必填 | 說明                                  |
| ------ | ------ | ---- | ------------------------------------- |
| `id`   | string | ✅   | 角色標識：`owner` / `admin` / 自訂 ID |
| `name` | string | -    | 角色顯示名稱（自訂角色需要）          |

**標準角色 ID：**

| ID      | 說明        |
| ------- | ----------- |
| `owner` | 群主/建立者 |
| `admin` | 管理員      |

**角色範例：**

```json
// 群主
"roles": [{ "id": "owner" }]

// 管理員
"roles": [{ "id": "admin" }]

// 多角色
"roles": [
  { "id": "owner" },
  { "id": "tech-team", "name": "技術組" },
  { "id": "vip", "name": "VIP會員" }
]
```

### 訊息 (messages)

| 欄位                | 類型           | 必填 | 說明                              |
| ------------------- | -------------- | ---- | --------------------------------- |
| `sender`            | string         | ✅   | 發送者的 `platformId`             |
| `accountName`       | string         | ✅   | 發送時的帳號名稱                  |
| `groupNickname`     | string         | -    | 發送時的群暱稱                    |
| `timestamp`         | number         | ✅   | 秒級 Unix 時間戳                  |
| `type`              | number         | ✅   | 訊息類型（見下方對照表）          |
| `content`           | string \| null | ✅   | 訊息內容（非文字訊息可為 `null`） |
| `platformMessageId` | string         | -    | 訊息的平台原始 ID                 |
| `replyToMessageId`  | string         | -    | 回覆的目標訊息 ID                 |

#### 訊息 ID 與回覆關係說明

**`platformMessageId`**（訊息的平台原始 ID）：

- 儲存訊息在原始平台上的唯一標識（如 Discord 的 snowflake ID、QQ 的訊息 ID）
- 用於在查詢時關聯 `replyToMessageId`，以顯示被回覆訊息的內容
- 如果平台不提供訊息 ID，可省略此欄位

**`replyToMessageId`**（回覆的目標訊息 ID）：

- 儲存被回覆訊息的**平台原始 ID**
- 透過與其他訊息的 `platformMessageId` 關聯，可查詢被回覆訊息的內容和發送者
- 僅當訊息是回覆類型時才有意義
- 如果平台不支援或資料不包含回覆關係，可省略此欄位

---

## 訊息類型對照表

::: tip 提示
若您的聊天記錄中有其他特殊類型需要支援，請提交 issue 說明情況，我們會評估是否加入標準訊息類型中。
:::

### 基礎訊息類型 (0-19)

| 值  | 名稱     | 說明        |
| --- | -------- | ----------- |
| 0   | TEXT     | 文字訊息    |
| 1   | IMAGE    | 圖片        |
| 2   | VOICE    | 語音        |
| 3   | VIDEO    | 影片        |
| 4   | FILE     | 檔案        |
| 5   | EMOJI    | 表情包/貼紙 |
| 7   | LINK     | 連結/卡片   |
| 8   | LOCATION | 位置        |

### 互動訊息類型 (20-39)

| 值  | 名稱       | 說明                   |
| --- | ---------- | ---------------------- |
| 20  | RED_PACKET | 紅包                   |
| 21  | TRANSFER   | 轉帳                   |
| 22  | POKE       | 拍一拍/戳一戳          |
| 23  | CALL       | 語音/視訊通話          |
| 24  | SHARE      | 分享（音樂、小程序等） |
| 25  | REPLY      | 引用回覆               |
| 26  | FORWARD    | 轉傳訊息               |
| 27  | CONTACT    | 名片訊息               |

### 系統訊息類型 (80+)

| 值  | 名稱   | 說明                           |
| --- | ------ | ------------------------------ |
| 80  | SYSTEM | 系統訊息（入群/退群/群公告等） |
| 81  | RECALL | 撤回訊息                       |
| 99  | OTHER  | 其他/未知                      |

## 頭像格式說明

頭像欄位 `avatar` 和 `groupAvatar` 支援兩種格式：

### 1. Data URL

內嵌式格式，圖片資料直接編碼在檔案中，離線可用：

```
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...
```

支援的圖片 MIME 類型：

- `image/jpeg` - JPEG 格式（推薦，體積較小）
- `image/png` - PNG 格式
- `image/gif` - GIF 格式
- `image/webp` - WebP 格式

### 2. 網路 URL

外連格式，圖片儲存在網路伺服器，體積更小但需網路存取：

```
https://example.com/avatars/user123.jpg
```

::: tip 建議

- 如果需要離線使用或長期存檔，推薦使用 Data URL 格式
- 匯出 Data URL 時建議將頭像壓縮為 100×100 像素以內，以減小檔案體積
- 如果頭像來自可靠的長期有效的 CDN，可使用網路 URL 以減小檔案體積 :::

## 完整範例

### 群聊範例（含可選欄位）

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1703001600,
    "generator": "My Converter Tool",
    "description": "2024年技術交流群聊天記錄備份"
  },
  "meta": {
    "name": "技術交流群",
    "platform": "wechat",
    "type": "group",
    "groupId": "38988428513",
    "groupAvatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "ownerId": "abc123"
  },
  "members": [
    {
      "platformId": "abc123",
      "accountName": "張三",
      "groupNickname": "群主-張三",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "roles": [{ "id": "owner" }]
    },
    {
      "platformId": "def456",
      "accountName": "李四",
      "groupNickname": "管理員",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "roles": [{ "id": "admin" }]
    }
  ],
  "messages": [
    {
      "platformMessageId": "msg_001",
      "sender": "abc123",
      "accountName": "張三",
      "groupNickname": "群主-張三",
      "timestamp": 1703001600,
      "type": 0,
      "content": "大家好！歡迎加入技術交流群~"
    },
    {
      "platformMessageId": "msg_002",
      "sender": "def456",
      "accountName": "李四",
      "groupNickname": "管理員",
      "timestamp": 1703001610,
      "type": 25,
      "content": "收到！",
      "replyToMessageId": "msg_001"
    }
  ]
}
```

### 私聊範例

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1703001600
  },
  "meta": {
    "name": "與小明的對話",
    "platform": "qq",
    "type": "private"
  },
  "members": [
    {
      "platformId": "123456789",
      "accountName": "我",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    },
    {
      "platformId": "987654321",
      "accountName": "小明",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    }
  ],
  "messages": [
    {
      "sender": "123456789",
      "accountName": "我",
      "timestamp": 1703001600,
      "type": 0,
      "content": "在嗎？"
    }
  ]
}
```

## JSONL 流式格式

JSONL（JSON Lines）格式適用於**超大規模聊天記錄**（>100 萬條），可避免記憶體溢位問題。

### 格式特點

- 每行一個 JSON 物件
- 透過 `_type` 欄位區分行類型：`header` / `member` / `message`
- 記憶體佔用恆定（約 100MB），支援 GB 級檔案
- 支援串流寫入，可邊匯出邊追加

### 行類型說明

| `_type`   | 說明                             | 是否必需        |
| --------- | -------------------------------- | --------------- |
| `header`  | 檔案頭，包含 `chatlab` 和 `meta` | ✅ 必須在第一行 |
| `member`  | 成員資訊                         | - 可選          |
| `message` | 訊息記錄                         | ✅ 至少一條     |

### 完整範例

```jsonl
{"_type":"header","chatlab":{"version":"0.0.2","exportedAt":1703001600},"meta":{"name":"技術交流群","platform":"qq","type":"group"}}
{"_type":"member","platformId":"123456","accountName":"張三","groupNickname":"群主","roles":[{"id":"owner"}]}
{"_type":"member","platformId":"789012","accountName":"李四"}
{"_type":"message","platformMessageId":"msg_001","sender":"123456","accountName":"張三","groupNickname":"群主","timestamp":1703001600,"type":0,"content":"大家好！"}
{"_type":"message","sender":"789012","accountName":"李四","timestamp":1703001610,"type":0,"content":"你好！"}
{"_type":"message","sender":"123456","accountName":"張三","groupNickname":"群主","timestamp":1703001620,"type":1,"content":"[圖片]"}
```

### 解析規則

1. **第一行必須是 header**：包含 `chatlab` 版本和 `meta` 元資訊
2. **成員行在訊息之前**：可選，如果省略，成員資訊會從訊息中自動收集
3. **訊息按時間順序排列**：建議按 `timestamp` 升冪排列
4. **每行獨立完整**：單行解析錯誤可跳過繼續處理
5. **支援註解行**：以 `#` 開頭的行會被跳過（可用於新增備註）

::: warning 注意

- 每行必須是**有效的 JSON**（不能跨行）
- 行之間用換行符 `\n` 分隔

:::

## 版本歷史

| 版本  | 日期       | 變更                                                                           |
| ----- | ---------- | ------------------------------------------------------------------------------ |
| 0.0.1 | 2025-12-22 | 初始版本                                                                       |
| 0.0.2 | 2026-01-09 | 新增 roles、ownerId、platformMessageId、replyToMessageId 欄位；新增 JSONL 格式 |
