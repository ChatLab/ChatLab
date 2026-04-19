---
outline: deep
---

# Pull 远程数据源协议

> v1

本文档定义第三方数据源暴露标准 HTTP 端点供 ChatLab 主动拉取数据的协议规范。这是 ChatLab 生态**推荐的第三方集成方式**。

::: tip 两种导入方式

- **[Push 模式](./chatlab-import.md)**：外部系统主动将数据推送到 ChatLab 的导入接口。适用于脚本集成、一次性文件导入。
- **Pull 模式**（本文档）：第三方暴露标准 HTTP 端点，ChatLab 主动拉取数据。**推荐的第三方集成方式。**

:::

## 为什么 Pull 是推荐方案

- 第三方工具是数据生产者，天然适合暴露数据；ChatLab 是数据消费者/分析者，天然适合主动获取
- 用户只需在 ChatLab UI 中输入数据源地址，即可浏览、选择、同步——操作完全在 ChatLab 端完成
- Push 模式需要第三方实现 HTTP 客户端逻辑（批次管理、重试、游标维护），门槛更高
- Pull 协议定义的是**通用数据暴露标准**，不只服务 ChatLab，任何兼容工具都可以接入

**适用场景：**

- 外部采集端运行在远程设备上，只需暴露 HTTP 接口
- 用户希望在 ChatLab UI 上浏览可用对话、选择导入、点击"立即同步"
- 需要定时自动增量同步的长期运行场景

---

## 概述

Pull 模式的工作流程分为三个阶段：

```
1. 发现：ChatLab 获取数据源上的所有可用对话列表
2. 拉取：用户选择对话后，ChatLab 拉取历史消息
3. 同步：定时增量拉取新消息（可选 SSE 实时通知加速）
```

第三方数据源只需按本协议实现标准 HTTP 端点，ChatLab（以及未来任何兼容工具）即可自动完成发现、全量拉取和增量同步。

---

## 阶段一：发现可用对话

ChatLab 连接到远程数据源后，首先获取所有可拉取的对话列表。

### GET /sessions

```
GET {baseUrl}/sessions
Authorization: Bearer {token}     ← 仅配置了 token 时携带
Accept: application/json
```

**可选参数：**

| 参数      | 类型   | 说明                     |
| --------- | ------ | ------------------------ |
| `keyword` | string | 按对话名称模糊搜索       |
| `limit`   | number | 返回条数限制（默认全部） |

**响应：**

```json
{
  "sessions": [
    {
      "id": "xxx@chatroom",
      "name": "产品讨论群",
      "platform": "wechat",
      "type": "group",
      "messageCount": 58000,
      "memberCount": 86,
      "lastMessageAt": 1711468800
    },
    {
      "id": "wxid_friend_a",
      "name": "张三",
      "platform": "wechat",
      "type": "private",
      "messageCount": 1200,
      "memberCount": 2,
      "lastMessageAt": 1711465200
    }
  ]
}
```

| 字段            | 类型   | 必填 | 说明                                |
| --------------- | ------ | ---- | ----------------------------------- |
| `id`            | string | 是   | 对话在数据源中的唯一标识            |
| `name`          | string | 是   | 对话名称（群名/联系人名）           |
| `platform`      | string | 是   | 平台标识（与 Push 模式相同）        |
| `type`          | string | 是   | `group` / `private`                 |
| `messageCount`  | number | 否   | 消息总数（用于 ChatLab 展示预估量） |
| `memberCount`   | number | 否   | 成员数                              |
| `lastMessageAt` | number | 否   | 最新消息时间戳                      |

ChatLab 在 UI 中展示该列表，用户选择需要导入的对话。

---

## 阶段二：拉取对话数据

用户选定对话后，ChatLab 拉取指定对话的数据。

### GET /sessions/:id/messages

```
GET {baseUrl}/sessions/{sessionId}/messages?format=chatlab&since={timestamp}
Authorization: Bearer {token}
Accept: application/json, application/x-ndjson
```

| 参数        | 必填 | 说明                                                                |
| ----------- | ---- | ------------------------------------------------------------------- |
| `sessionId` | 是   | 来自阶段一返回的对话 `id`                                           |
| `format`    | 是   | 固定为 `chatlab`，要求数据源返回 ChatLab 标准格式                   |
| `since`     | 否   | Unix 时间戳（秒级）。省略或为 `0` 时为全量拉取，大于 0 时为增量拉取 |
| `end`       | 否   | Unix 时间戳（秒级）。指定时间范围上界，用于历史回填等分段拉取       |
| `limit`     | 否   | 单次返回的最大消息数，用于分页                                      |
| `offset`    | 否   | 分页偏移量，配合 `limit` 使用                                       |

### 数据携带规则

- **首次全量**（`since` 为空或 0）：**必须**包含 `chatlab` + `meta` + `members` + `messages`
- **增量同步**（`since > 0`）：**必须**包含 `messages`。`meta` / `members` **仅在发生实际变更时携带**，未变更时不得携带，以避免历史快照覆盖当前状态
- 无新数据时返回空 `messages` 数组

### 响应格式

响应为标准 [ChatLab Format](./chatlab-format.md)（JSON 或 JSONL），并附带 `sync` 同步元信息。

```json
{
  "chatlab": { "version": "0.0.2", "exportedAt": 1711468800 },
  "meta": { "name": "产品讨论群", "platform": "wechat", "type": "group" },
  "members": [ ... ],
  "messages": [ ... ],
  "sync": {
    "hasMore": true,
    "nextSince": 1711468800,
    "nextOffset": 5000,
    "watermark": 1711470000
  }
}
```

### sync 同步元信息

| 字段         | 类型    | 说明                                                                                       |
| ------------ | ------- | ------------------------------------------------------------------------------------------ |
| `hasMore`    | boolean | 是否还有更多数据。为 `true` 时 ChatLab 自动续拉                                            |
| `nextSince`  | number  | 下一次请求建议使用的 `since` 值                                                            |
| `nextOffset` | number  | 下一次请求建议使用的 `offset` 值，用于分页续拉                                             |
| `watermark`  | number  | 本次拉取的快照上界时间戳，防止分页期间新数据写入导致的窗口漂移                             |

**sync 块的必要性规则：**

| 数据源返回方式             | sync 块要求 | 说明                                                             |
| -------------------------- | ----------- | ---------------------------------------------------------------- |
| 单次返回全部数据（不分页） | 可选        | ChatLab 视 `messages` 为完整结果                                 |
| 支持 `limit`/`offset` 分页 | **必须**    | 至少包含 `hasMore`；若无法保证快照一致性，还必须包含 `watermark` |

::: warning 注意
若数据源支持分页但未返回 `sync` 块，ChatLab 不保证自动续拉和分页一致性——仅处理首次返回的数据。
:::

### 快照一致性要求

- 同一次分页拉取（通过 `limit`/`offset` 遍历）**应当**基于同一数据快照视图
- 若数据源无法保证快照一致性，**必须**返回 `sync.watermark`，供 ChatLab 固定拉取窗口上界

### 分批拉取策略

对于大量历史数据（如数万条消息），推荐两种分批方式：

1. **时间窗口分批**：通过 `since` + `end` 指定时间段，逐段拉取
2. **分页分批**：通过 `limit` + `offset` 做数据库级分页，结合 `sync` 块自动续拉

ChatLab 会自动处理分批场景，通过去重机制保证不重复写入。

---

## 阶段三：定时增量同步

ChatLab 按用户配置的间隔，定期对已订阅的对话执行增量拉取：

```
GET {baseUrl}/sessions/{sessionId}/messages?format=chatlab&since={lastPullAt}
```

远程数据源返回 `since` 之后的增量消息。ChatLab 通过内部导入管道处理（去重、meta/members 更新、FTS 索引等全部复用 Push 模式逻辑）。

---

## 可选：SSE 实时通知

除定时轮询外，远程数据源可**可选**实现 SSE（Server-Sent Events）端点，用于**通知 ChatLab 有新数据可拉取**。

::: warning 重要
SSE 仅作为通知通道，不是数据同步主通道。ChatLab 不假设 SSE 事件可靠送达（网络断连、进程重启均可能丢失事件）。最终数据一致性始终由定时 Pull 保证。SSE 的作用是将增量同步延迟从"分钟级"降到"秒级"。
:::

### GET /push/messages

```
GET {baseUrl}/push/messages
Authorization: Bearer {token}
Accept: text/event-stream
```

**事件格式：**

```
event: message.new
data: {"eventId":"evt_001","sessionId":"xxx@chatroom","timestamp":1711468800}
```

| 字段                | 类型   | 必填 | 说明                                       |
| ------------------- | ------ | ---- | ------------------------------------------ |
| `eventId`           | string | 是   | 事件唯一 ID，用于 ChatLab 去重已处理的通知 |
| `sessionId`         | string | 是   | 有新消息的对话 ID                          |
| `timestamp`         | number | 是   | 新消息的时间戳                             |
| `platformMessageId` | string | 否   | 新消息的平台 ID（如可获取）                |

ChatLab 接收到 SSE 事件后，**触发一次该 session 的增量拉取**（调用 `GET /sessions/:id/messages?format=chatlab&since={lastPullAt}`），而非直接将事件数据写入存储。

---

## 认证

远程数据源可选择是否要求认证。如果需要，使用 `Authorization: Bearer {token}` 机制。

::: tip SSE 认证
部分数据源额外支持 `?access_token=TOKEN` 查询参数方式传递 Token（SSE 长连接场景推荐此方式，因为 EventSource API 不支持自定义 Header）。ChatLab 在连接 SSE 时也支持查询参数传 Token。
:::

---

## 实现指南

### 最小实现（2 个端点）

只需实现以下两个端点即可接入 ChatLab：

| 端点                                                | 说明                  |
| --------------------------------------------------- | --------------------- |
| `GET /sessions`                                     | 返回对话列表          |
| `GET /sessions/:id/messages?format=chatlab&since=X` | 返回 ChatLab 格式数据 |

最小实现不需要分页、SSE 或复杂的 `sync` 块。ChatLab 会将响应中的 `messages` 视为完整数据。

### 增强实现

| 能力                       | 说明                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `GET /push/messages`       | SSE 实时通知（仅唤醒拉取，不传输完整数据）                   |
| 支持 `limit`/`offset` 分页 | 大量历史数据的分页拉取                                       |
| 支持 `end` 参数            | 时间窗口分段拉取                                             |
| 响应包含 `sync` 块         | 提供 `hasMore`/`nextSince`/`nextOffset`/`watermark` 续拉信息 |

### 数据格式

所有数据响应必须符合 [ChatLab 标准化格式规范](./chatlab-format.md)（JSON 或 JSONL），包括 `chatlab`、`meta`、`members`、`messages` 四个标准块。

### 媒体文件

如果数据源的消息中包含媒体引用，`attachments` 中的 `filePath` 或 `dataUri` 可指向数据源的媒体服务端点。ChatLab 当前按"协议预留"处理，未来版本将支持从数据源拉取媒体文件。

---

## 示例场景

某采集端在手机上持续采集微信消息，暴露 `GET /sessions` 和 `GET /sessions/:id/messages` 两个端点。用户在 ChatLab 中操作：

```
1. 在 ChatLab 设置中添加远程数据源（输入采集端 URL + 可选 Token）

2. ChatLab 调用 GET {baseUrl}/sessions
   → 展示 86 个群和 200 个私聊

3. 用户选择其中 5 个群导入

4. ChatLab 立即执行全量拉取：
   GET {baseUrl}/sessions/{id}/messages?format=chatlab&since=0
   → 如有 sync.hasMore=true，自动续拉直到全部完成

5. 之后每小时自动增量同步：
   GET {baseUrl}/sessions/{id}/messages?format=chatlab&since={lastPullAt}

6. 如果采集端实现了 SSE：
   收到 message.new 事件 → 立即触发增量拉取（不等定时器）

7. 用户可随时在 ChatLab UI 点击"立即同步"
```

---

## 相关文档

- [ChatLab API 文档](./chatlab-api.md) — 查询、导出和系统端点
- [Push 导入协议](./chatlab-import.md) — 外部系统主动推送数据到 ChatLab
- [ChatLab 标准化格式规范](./chatlab-format.md) — 数据交换格式定义
