# ChatLab 标准化格式规范 v0.0.2

ChatLab 定义了一套标准的聊天记录数据交换格式，用于支持多平台数据的统一导入和分析。

只要你将聊天记录转为该格式，那么就可以被 ChatLab 解析并使用其分析能力。

::: warning 注意该格式规范目前仍处于早期制定阶段，部分字段和结构可能会在后续版本中调整。:::

## 概述

### 支持的文件格式

| 格式      | 扩展名   | 适用场景                                          |
| --------- | -------- | ------------------------------------------------- |
| **JSON**  | `.json`  | 中小型记录（<100 万条），结构清晰，易于阅读       |
| **JSONL** | `.jsonl` | 超大规模记录（>100 万条），流式处理，内存占用恒定 |

### 格式对比

| 特性         | JSON                   | JSONL                   |
| ------------ | ---------------------- | ----------------------- |
| 内存占用     | 需加载完整结构         | 逐行处理，恒定 (~100MB) |
| 文件大小限制 | ~1GB（取决于内存）     | 无实际限制              |
| 追加写入     | ❌ 需重写整个文件      | ✅ 直接追加行           |
| 错误恢复     | 单处错误整文件失效     | 可跳过错误行继续        |
| 可读性       | ⭐⭐⭐ 易于阅读        | ⭐⭐ 每行一条记录       |
| 推荐场景     | 小中型记录 (<100 万条) | 大型记录 (>100 万条)    |

## 快速说明

以下是一个**最小化**的 ChatLab 格式示例，只包含必要字段：

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
      "accountName": "张三"
    }
  ],
  "messages": [
    {
      "sender": "123456",
      "accountName": "张三",
      "timestamp": 1703001600,
      "type": 0,
      "content": "大家好！"
    }
  ]
}
```

---

## JSON 格式详细说明

### 文件头 (chatlab)

| 字段          | 类型   | 必填 | 说明                         |
| ------------- | ------ | ---- | ---------------------------- |
| `version`     | string | ✅   | 格式版本号，当前为 `"0.0.2"` |
| `exportedAt`  | number | ✅   | 导出时间（秒级 Unix 时间戳） |
| `generator`   | string | -    | 生成工具名称                 |
| `description` | string | -    | 描述信息                     |

### 元信息 (meta)

| 字段          | 类型          | 必填 | 说明                                                     |
| ------------- | ------------- | ---- | -------------------------------------------------------- |
| `name`        | string        | ✅   | 群名或对话名                                             |
| `platform`    | string        | ✅   | 平台标识，如 `qq` / `wechat` / `discord` / `whatsapp` 等 |
| `type`        | string        | ✅   | 聊天类型：`group`（群聊）/ `private`（私聊）             |
| `groupId`     | string        | -    | 群 ID（仅群聊）                                          |
| `groupAvatar` | string        | -    | 群头像（Data URL 格式）                                  |
| `ownerId`     | string        | -    | 所有者/导出者的 platformId                               |
| `sources`     | MergeSource[] | -    | 合并来源（合并工具生成，见下方说明）                     |

#### MergeSource 结构（合并来源）

当使用合并工具合并多个聊天记录文件时，`sources` 字段会记录原始文件的来源信息：

| 字段           | 类型   | 必填 | 说明     |
| -------------- | ------ | ---- | -------- |
| `filename`     | string | ✅   | 原文件名 |
| `platform`     | string | -    | 原平台   |
| `messageCount` | number | ✅   | 消息数量 |

### 成员 (members)

| 字段            | 类型         | 必填 | 说明                      |
| --------------- | ------------ | ---- | ------------------------- |
| `platformId`    | string       | ✅   | 用户唯一标识              |
| `accountName`   | string       | ✅   | 账号名称                  |
| `groupNickname` | string       | -    | 群昵称（仅群聊）          |
| `aliases`       | string[]     | -    | 用户自定义别名            |
| `avatar`        | string       | -    | 用户头像（Data URL 格式） |
| `roles`         | MemberRole[] | -    | 成员角色（可多个）        |

#### 角色 (roles)

成员可以拥有一个或多个角色，用于标识群主、管理员等身份：

| 字段   | 类型   | 必填 | 说明                                   |
| ------ | ------ | ---- | -------------------------------------- |
| `id`   | string | ✅   | 角色标识：`owner` / `admin` / 自定义ID |
| `name` | string | -    | 角色显示名称（自定义角色需要）         |

**标准角色 ID：**

| ID      | 说明        |
| ------- | ----------- |
| `owner` | 群主/创建者 |
| `admin` | 管理员      |

**角色示例：**

```json
// 群主
"roles": [{ "id": "owner" }]

// 管理员
"roles": [{ "id": "admin" }]

// 多角色
"roles": [
  { "id": "owner" },
  { "id": "tech-team", "name": "技术组" },
  { "id": "vip", "name": "VIP会员" }
]
```

### 消息 (messages)

| 字段                | 类型           | 必填 | 说明                              |
| ------------------- | -------------- | ---- | --------------------------------- |
| `sender`            | string         | ✅   | 发送者的 `platformId`             |
| `accountName`       | string         | ✅   | 发送时的账号名称                  |
| `groupNickname`     | string         | -    | 发送时的群昵称                    |
| `timestamp`         | number         | ✅   | 秒级 Unix 时间戳                  |
| `type`              | number         | ✅   | 消息类型（见下方对照表）          |
| `content`           | string \| null | ✅   | 消息内容（非文本消息可为 `null`） |
| `platformMessageId` | string         | -    | 消息的平台原始 ID                 |
| `replyToMessageId`  | string         | -    | 回复的目标消息 ID                 |

#### 消息 ID 与回复关系说明

**`platformMessageId`**（消息的平台原始 ID）：

- 存储消息在原始平台上的唯一标识（如 Discord 的 snowflake ID、QQ 的消息 ID）
- 用于在查询时关联 `replyToMessageId`，以显示被回复消息的内容
- 如果平台不提供消息 ID，可省略此字段

**`replyToMessageId`**（回复的目标消息 ID）：

- 存储被回复消息的**平台原始 ID**
- 通过与其他消息的 `platformMessageId` 关联，可查询被回复消息的内容和发送者
- 仅当消息是回复类型时才有意义
- 如果平台不支持或数据不包含回复关系，可省略此字段

---

## 消息类型对照表

::: tip 提示若您的聊天记录中有其他特殊类型需要支持，请提交 issue 说明情况，我们会评估是否加入标准消息类型中。:::

### 基础消息类型 (0-19)

| 值  | 名称     | 说明        |
| --- | -------- | ----------- |
| 0   | TEXT     | 文本消息    |
| 1   | IMAGE    | 图片        |
| 2   | VOICE    | 语音        |
| 3   | VIDEO    | 视频        |
| 4   | FILE     | 文件        |
| 5   | EMOJI    | 表情包/贴纸 |
| 7   | LINK     | 链接/卡片   |
| 8   | LOCATION | 位置        |

### 交互消息类型 (20-39)

| 值  | 名称       | 说明                   |
| --- | ---------- | ---------------------- |
| 20  | RED_PACKET | 红包                   |
| 21  | TRANSFER   | 转账                   |
| 22  | POKE       | 拍一拍/戳一戳          |
| 23  | CALL       | 语音/视频通话          |
| 24  | SHARE      | 分享（音乐、小程序等） |
| 25  | REPLY      | 引用回复               |
| 26  | FORWARD    | 转发消息               |
| 27  | CONTACT    | 名片消息               |

### 系统消息类型 (80+)

| 值  | 名称   | 说明                           |
| --- | ------ | ------------------------------ |
| 80  | SYSTEM | 系统消息（入群/退群/群公告等） |
| 81  | RECALL | 撤回消息                       |
| 99  | OTHER  | 其他/未知                      |

## 头像格式说明

头像字段 `avatar` 和 `groupAvatar` 支持两种格式：

### 1. Data URL

嵌入式格式，图片数据直接编码在文件中，离线可用：

```
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...
```

支持的图片 MIME 类型：

- `image/jpeg` - JPEG 格式（推荐，体积较小）
- `image/png` - PNG 格式
- `image/gif` - GIF 格式
- `image/webp` - WebP 格式

### 2. 网络 URL

外链格式，图片存储在网络服务器，体积更小但需网络访问：

```
https://example.com/avatars/user123.jpg
```

::: tip 建议

- 如果需要离线使用或长期存档，推荐使用 Data URL 格式
- 导出 Data URL 时建议将头像压缩为 100×100 像素以内，以减小文件体积
- 如果头像来自可靠的长期有效的 CDN，可使用网络 URL 以减小文件体积 :::

## 完整示例

### 群聊示例（含可选字段）

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1703001600,
    "generator": "My Converter Tool",
    "description": "2024年技术交流群聊天记录备份"
  },
  "meta": {
    "name": "技术交流群",
    "platform": "wechat",
    "type": "group",
    "groupId": "38988428513",
    "groupAvatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "ownerId": "abc123"
  },
  "members": [
    {
      "platformId": "abc123",
      "accountName": "张三",
      "groupNickname": "群主-张三",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "roles": [{ "id": "owner" }]
    },
    {
      "platformId": "def456",
      "accountName": "李四",
      "groupNickname": "管理员",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "roles": [{ "id": "admin" }]
    }
  ],
  "messages": [
    {
      "platformMessageId": "msg_001",
      "sender": "abc123",
      "accountName": "张三",
      "groupNickname": "群主-张三",
      "timestamp": 1703001600,
      "type": 0,
      "content": "大家好！欢迎加入技术交流群~"
    },
    {
      "platformMessageId": "msg_002",
      "sender": "def456",
      "accountName": "李四",
      "groupNickname": "管理员",
      "timestamp": 1703001610,
      "type": 25,
      "content": "收到！",
      "replyToMessageId": "msg_001"
    }
  ]
}
```

### 私聊示例

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1703001600
  },
  "meta": {
    "name": "与小明的对话",
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
      "content": "在吗？"
    }
  ]
}
```

## JSONL 流式格式

JSONL（JSON Lines）格式适用于**超大规模聊天记录**（>100 万条），可避免内存溢出问题。

### 格式特点

- 每行一个 JSON 对象
- 通过 `_type` 字段区分行类型：`header` / `member` / `message`
- 内存占用恒定（约 100MB），支持 GB 级文件
- 支持流式写入，可边导出边追加

### 行类型说明

| `_type`   | 说明                             | 是否必需        |
| --------- | -------------------------------- | --------------- |
| `header`  | 文件头，包含 `chatlab` 和 `meta` | ✅ 必须在第一行 |
| `member`  | 成员信息                         | - 可选          |
| `message` | 消息记录                         | ✅ 至少一条     |

### 完整示例

```jsonl
{"_type":"header","chatlab":{"version":"0.0.2","exportedAt":1703001600},"meta":{"name":"技术交流群","platform":"qq","type":"group"}}
{"_type":"member","platformId":"123456","accountName":"张三","groupNickname":"群主","roles":[{"id":"owner"}]}
{"_type":"member","platformId":"789012","accountName":"李四"}
{"_type":"message","platformMessageId":"msg_001","sender":"123456","accountName":"张三","groupNickname":"群主","timestamp":1703001600,"type":0,"content":"大家好！"}
{"_type":"message","sender":"789012","accountName":"李四","timestamp":1703001610,"type":0,"content":"你好！"}
{"_type":"message","sender":"123456","accountName":"张三","groupNickname":"群主","timestamp":1703001620,"type":1,"content":"[图片]"}
```

### 解析规则

1. **第一行必须是 header**：包含 `chatlab` 版本和 `meta` 元信息
2. **成员行在消息之前**：可选，如果省略，成员信息会从消息中自动收集
3. **消息按时间顺序排列**：建议按 `timestamp` 升序排列
4. **每行独立完整**：单行解析错误可跳过继续处理
5. **支持注释行**：以 `#` 开头的行会被跳过（可用于添加备注）

::: warning 注意

- 每行必须是**有效的 JSON**（不能跨行）
- 行之间用换行符 `\n` 分隔

:::

## 版本历史

| 版本  | 日期       | 变更                                                                           |
| ----- | ---------- | ------------------------------------------------------------------------------ |
| 0.0.1 | 2025-12-22 | 初始版本                                                                       |
| 0.0.2 | 2026-01-09 | 新增 roles、ownerId、platformMessageId、replyToMessageId 字段；新增 JSONL 格式 |
