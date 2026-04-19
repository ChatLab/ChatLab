---
outline: deep
---

# Push 导入协议

> v1

本文档定义外部数据源向 ChatLab 推送聊天数据的标准导入协议。覆盖首次全量导入、历史回填、周期性增量同步三类场景。

::: tip 两种导入方式

- **Push 模式**（本文档）：外部系统主动将数据推送到 ChatLab 的导入接口。适用于脚本集成、一次性文件导入等场景。
- **[Pull 模式](./chatlab-pull.md)**：第三方暴露标准 HTTP 端点，ChatLab 主动拉取数据。**推荐的第三方集成方式。**

两种模式底层共用同一套导入逻辑（去重、meta/members 更新、FTS 索引），数据格式统一为 [ChatLab Format](./chatlab-format.md)。

:::

## 设计原则

1. **统一入口**：首次导入和增量导入使用同一个端点，调用方无需区分。
2. **接口最小化**：1 个导入接口 + 2 个查询接口覆盖全部 Push 场景。
3. **双层幂等**：请求级幂等（Idempotency-Key）+ 记录级去重（platformMessageId / 内容哈希），承诺 **at-least-once + deterministic dedupe**。
4. **同步优先**：小批量导入同步返回 `200 OK` 和写入结果。
5. **默认自动更新**：meta 和 members 默认随导入请求自动更新，可通过 `options` 控制。

---

## 基础约定

### 服务地址

```
Base URL：http://<host>:<port>   （桌面端默认 127.0.0.1:5200）
Prefix：  /api/v1
```

### 认证

所有请求必须携带 Bearer Token：

```
Authorization: Bearer <token>
```

Token 在 ChatLab 设置页面生成，格式为 `clb_` + 64 字符 hex。

### Content-Type

```
application/json         # 标准 JSON body（≤50MB）
application/x-ndjson    # JSONL 流式（无大小限制）
```

---

## 接口总表

| 方法   | 路径                         | 说明                                         |
| ------ | ---------------------------- | -------------------------------------------- |
| `POST` | `/api/v1/imports/:sessionId` | 导入消息到指定会话（首次自动创建，后续追加） |
| `GET`  | `/api/v1/sessions/:id`       | 查询会话状态（主要用于对账校验）             |
| `GET`  | `/api/v1/sessions`           | 列出所有会话（发现目标 Session）             |

查询接口的详细说明请参阅 [ChatLab API 文档](./chatlab-api.md)。

---

## POST /api/v1/imports/:sessionId

**唯一导入入口。** 会话不存在时自动创建，已存在时追加数据并自动更新 meta/members。

### Path 参数

| 参数        | 类型   | 说明                                                                                 |
| ----------- | ------ | ------------------------------------------------------------------------------------ |
| `sessionId` | string | Session ID，由调用方生成并维护。同一聊天来源必须保持固定，跨批一致。生成策略见下方。 |

**Session ID 生成策略：**

| 优先级 | 场景 | 推荐格式 | 示例 |
| --- | --- | --- | --- |
| 1（首选） | 有平台原始 ID | `{platform}_{originalId}` | `wechat_xxx@chatroom`、`qq_123456789` |
| 2 | 文件导入（有结构化 ID） | `{platform}_{meta.groupId}` 或 `{platform}_{对方platformId}` | `wechat_xxx@chatroom` |
| 3 | 文件导入（无结构化标识） | `file_{SHA256(文件内容)[:16]}` | `file_a1b2c3d4e5f6g7h8` |
| 4（兜底） | 一次性导入 | `import_{UUID}` | `import_550e8400-e29b-41d4-a716-446655440000` |

::: warning 注意
- 不建议使用文件路径作为 sessionId 的输入——文件重命名会导致 sessionId 变化
- 同一聊天来源的首次导入和增量导入**必须**使用相同的 sessionId
:::

### 请求 Header

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 是 | `Bearer <token>` |
| `Content-Type` | 是 | `application/json` 或 `application/x-ndjson` |
| `Idempotency-Key` | 建议 | 当前批次的唯一标识，用于重试安全。建议格式：`{sessionId}-{batchIndex}-{windowStart}` |
| `X-Dry-Run` | 否 | 设为 `true` 时仅分析不写入，返回预估结果 |

### 请求 Body（JSON 模式）

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1711468800,
    "generator": "YourSystem/1.0"
  },
  "meta": {
    "name": "产品讨论群",
    "platform": "wechat",
    "type": "group",
    "groupId": "xxx@chatroom",
    "groupAvatar": "data:image/jpeg;base64,...",
    "ownerId": "wxid_owner"
  },
  "members": [
    {
      "platformId": "wxid_a",
      "accountName": "张三",
      "groupNickname": "产品",
      "avatar": "data:image/jpeg;base64,...",
      "roles": [{ "id": "owner" }]
    }
  ],
  "messages": [
    {
      "platformMessageId": "msg_1001",
      "sender": "wxid_a",
      "accountName": "张三",
      "groupNickname": "产品",
      "timestamp": 1711468800,
      "type": 0,
      "content": "Hello",
      "replyToMessageId": "msg_1000"
    }
  ],
  "options": {
    "metaUpdateMode": "patch",
    "memberUpdateMode": "upsert"
  }
}
```

### options 对象（可选）

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
| --- | --- | --- | --- | --- |
| `metaUpdateMode` | string | `patch` | `patch` / `none` | `patch`：非空字段覆盖更新；`none`：跳过更新 |
| `memberUpdateMode` | string | `upsert` | `upsert` / `none` | `upsert`：新增+更新；`none`：跳过更新 |

::: tip 提示
回填历史数据时建议传 `"metaUpdateMode": "none"` 防止旧群名覆盖当前值。
:::

### 请求 Body（JSONL 模式）

每行一个 JSON 对象，通过 `_type` 字段区分类型。行顺序：`header` → `member`（零或多行） → `message`（一或多行）。

```jsonl
{"_type":"header","chatlab":{"version":"0.0.2","exportedAt":1711468800,"generator":"YourSystem/1.0"},"meta":{"name":"产品讨论群","platform":"wechat","type":"group","groupId":"xxx@chatroom"},"options":{"metaUpdateMode":"patch","memberUpdateMode":"upsert"}}
{"_type":"member","platformId":"wxid_a","accountName":"张三","groupNickname":"产品"}
{"_type":"message","platformMessageId":"msg_1001","sender":"wxid_a","accountName":"张三","timestamp":1711468800,"type":0,"content":"Hello"}
{"_type":"message","platformMessageId":"msg_1002","sender":"wxid_b","accountName":"李四","timestamp":1711468860,"type":0,"content":"Hi"}
```

### 各块携带规则

| 块         | 会话首次创建 | 后续增量导入 | 语义                                                           |
| ---------- | ------------ | ------------ | -------------------------------------------------------------- |
| `chatlab`  | 必填         | 可选         | 首次用于创建会话；后续用于版本兼容判断                         |
| `meta`     | 必填         | 可选         | 首次作为初始值；后续携带则非空字段自动覆盖更新                 |
| `members`  | 必填         | 可选         | 首次写入全量成员；后续按 `platformId` 做 upsert                |
| `messages` | 必填         | 必填         | 每批必须包含至少一条消息                                       |

**Meta 自动更新规则：**

- 调用方传了且值不为空的字段 → 覆盖更新
- 调用方未传或值为空的字段 → 保持原值不变
- `platform` 和 `type` 不允许增量更新（会话创建后不变）

**Members Upsert 规则：**

- 按 `platformId` 匹配：新 `platformId` → 插入为新成员；已存在的 → 更新非空字段
- 不携带 `members` 时：消息中出现的未知 `sender` 仍会被自动创建为成员（仅含最小信息）

---

### 字段定义

#### chatlab 对象

| 字段         | 类型   | 必填 | 说明                              |
| ------------ | ------ | ---- | --------------------------------- |
| `version`    | string | 是   | 格式版本号，当前为 `"0.0.2"`      |
| `exportedAt` | number | 是   | 导出/生成时间（秒级 Unix 时间戳） |
| `generator`  | string | 否   | 生成工具/系统名称                 |

#### meta 对象

| 字段          | 类型   | 首次必填 | 说明                                         |
| ------------- | ------ | -------- | -------------------------------------------- |
| `name`        | string | 是       | 群名/会话名                                  |
| `platform`    | string | 是       | 平台标识（见下方枚举）                       |
| `type`        | string | 是       | 会话类型：`group`（群聊）/ `private`（私聊） |
| `groupId`     | string | 否       | 群的平台原始 ID                              |
| `groupAvatar` | string | 否       | 群头像，base64 Data URL 或网络 URL           |
| `ownerId`     | string | 否       | 导出者/所有者的 platformId                   |

**平台标识枚举：**

| 值         | 平台      |
| ---------- | --------- |
| `wechat`   | 微信      |
| `qq`       | QQ        |
| `telegram` | Telegram  |
| `discord`  | Discord   |
| `whatsapp` | WhatsApp  |
| `line`     | LINE      |
| `slack`    | Slack     |
| `unknown`  | 未知/其他 |

::: tip 提示
如果你的平台不在上述列表中，可使用小写英文标识（如 `signal`、`matrix`），ChatLab 会按 `unknown` 的分析策略处理。
:::

#### members 数组元素

| 字段            | 类型   | 必填 | 说明                                   |
| --------------- | ------ | ---- | -------------------------------------- |
| `platformId`    | string | 是   | 成员在平台的唯一标识（QQ号、微信ID等） |
| `accountName`   | string | 建议 | 账号名称（不随群变化的原始昵称）       |
| `groupNickname` | string | 否   | 群内专属昵称                           |
| `avatar`        | string | 否   | 头像，base64 Data URL 或网络 URL       |
| `roles`         | array  | 否   | 角色列表，见 [角色定义](./chatlab-format.md#角色-roles) |

#### messages 数组元素

| 字段                | 类型         | 必填     | 说明                                                                |
| ------------------- | ------------ | -------- | ------------------------------------------------------------------- |
| `sender`            | string       | 是       | 发送者的 `platformId` 或保留标识（如 `SYSTEM`） |
| `timestamp`         | number       | 是       | 消息时间戳，秒级 Unix 时间戳                                        |
| `type`              | number       | 是       | 消息类型枚举（见 [消息类型](./chatlab-format.md#消息类型对照表)）   |
| `accountName`       | string       | 建议     | 发送时的账号名称                                                    |
| `groupNickname`     | string       | 否       | 发送时的群昵称                                                      |
| `content`           | string\|null | 否       | 纯文本内容，非文本消息可为 null                                     |
| `platformMessageId` | string       | 强烈建议 | 消息的平台原始 ID，去重的首选依据                                   |
| `replyToMessageId`  | string       | 否       | 回复目标消息的 `platformMessageId`                                  |

**sender 字段规则：**

1. 必须是稳定的 `platformId` 或保留标识 `SYSTEM`
2. 若 `sender` 对应的成员不在 `members` 中，ChatLab 自动补创建成员（仅含最小信息）
3. `SYSTEM` 用于系统消息（入群/退群/公告等），不计入成员统计

---

### 成功响应

```json
{
  "success": true,
  "data": {
    "sessionId": "wechat_xxx@chatroom",
    "created": false,
    "batch": {
      "receivedCount": 5000,
      "writtenCount": 4986,
      "duplicateCount": 14
    },
    "session": {
      "totalCount": 128640,
      "memberCount": 86,
      "firstTimestamp": 1609459200,
      "lastTimestamp": 1711468800
    },
    "updates": {
      "metaUpdated": true,
      "membersAdded": 3,
      "membersUpdated": 5
    }
  }
}
```

| 字段                     | 说明                                                  |
| ------------------------ | ----------------------------------------------------- |
| `created`                | `true` 表示本次请求触发了会话创建（首次导入）         |
| `batch.receivedCount`    | 本批收到的消息条数                                    |
| `batch.writtenCount`     | 实际写入的条数                                        |
| `batch.duplicateCount`   | 因去重跳过的条数                                      |
| `session.totalCount`     | 写入后会话的累计消息总数                              |
| `session.memberCount`    | 会话的成员总数                                        |
| `session.firstTimestamp` | 会话内最早消息时间戳                                  |
| `session.lastTimestamp`  | 会话内最新消息时间戳                                  |
| `updates.metaUpdated`    | 本次请求是否触发了 meta 更新                          |
| `updates.membersAdded`   | 本次新增的成员数                                      |
| `updates.membersUpdated` | 本次更新的成员数                                      |

---

## 去重语义

去重在单个 Session 内生效，不跨会话。

**优先级：**

1. 若消息提供了 `platformMessageId`，以此作为唯一键去重（高精度，推荐）。
2. 若未提供 `platformMessageId`，退化为内容哈希去重：`sha256(timestamp + '\0' + sender + '\0' + contentTag + '\0' + normalizedContent)`

| 层次               | 机制                                            | 适用范围                      | 精度     |
| ------------------ | ----------------------------------------------- | ----------------------------- | -------- |
| 请求级幂等         | `Idempotency-Key`                               | 同一 HTTP 请求的重试          | 精确     |
| 消息级去重（主键） | `platformMessageId`                             | 跨批次、跨窗口的同一条消息    | 精确     |
| 消息级去重（降级） | 内容哈希 `sha256(timestamp + sender + content)` | 无 platformMessageId 时的兜底 | 最大努力 |

::: warning 注意
- 同一 `platformMessageId` 的消息不会被重复写入，即使 content 不同（以首次写入为准）
- 内容哈希去重在"同一人、同一秒、完全相同内容"时判定为重复，存在极小概率误判
- **强烈建议**外部数据源提供 `platformMessageId`，这是最可靠的去重依据
:::

---

## 分批策略

### 默认批次大小

每批建议 **5000 条消息**。

| 约束               | 值           | 说明                            |
| ------------------ | ------------ | ------------------------------- |
| JSON body 大小上限 | 50MB         | 超过返回 `BODY_TOO_LARGE` (413) |
| JSONL body 大小    | 无限制       | 通过 stream 写入临时文件后处理  |
| 建议每批消息数     | 5000 条      | 兼顾性能和内存占用              |

### 分批原则

- 按时间顺序分批，从旧到新推送
- 批次间允许时间重叠（建议重叠 5~10 分钟），依靠去重吸收
- 每批独立请求，任意一批失败不影响其他批次
- 第一批必须携带 `chatlab` + `meta` + `members`（触发会话创建）
- 后续批次可仅携带 `messages`

### 游标维护（由调用方负责）

ChatLab 不为调用方维护游标。推荐结构：

```json
{
  "sessionId": "wechat_xxx@chatroom",
  "lastSyncedTimestamp": 1711468800,
  "lastSyncedMessageId": "msg_900000"
}
```

每批成功后，将响应中的 `session.lastTimestamp` 更新到游标。失败时保持游标不变，用相同的 `Idempotency-Key` 重试。

### 并发约束

当前版本：**同一时刻仅允许一个导入任务**。并发请求会收到 `IMPORT_IN_PROGRESS` (409) 错误。

---

## 标准调用流程

### 首次全量导入（Bootstrap）

```
1. 准备全量聊天数据，按时间顺序切分为 N 批（每批 ≤5000 条）

2. 第一批请求：
   POST /api/v1/imports/wechat_xxx@chatroom
   Body: { chatlab, meta, members, messages }
   → 响应 created: true，会话创建成功

3. 第 2~N 批请求：
   POST /api/v1/imports/wechat_xxx@chatroom
   Body: { messages }
   Idempotency-Key: {sessionId}-{batchIndex}-{windowStart}

4. 每批成功后记录游标；失败用相同 Idempotency-Key 重试

5. 全部批次完成后对账：
   GET /api/v1/sessions/wechat_xxx@chatroom
   → 校验 totalCount、firstTimestamp、lastTimestamp
```

### 历史回填（Backfill）

```
1. 确定需要补齐的时间区间 [start, end]
2. 按时间窗口拆分为多批
3. 依次调用 POST /api/v1/imports/:sessionId
   （建议设置 options.metaUpdateMode: "none" 防止旧群名覆盖）
4. 每批成功后更新本地游标
5. 可选：GET /api/v1/sessions/:id 对账
```

### 每日定时增量（Scheduled Sync）

```
1. 固定 Session ID + 定时器（如每小时/每天）
2. 从上次游标开始，向前重叠 5~10 分钟作为窗口起点
3. 拉取该时间窗口内的新消息
4. 如有新成员或群名变更，携带 meta/members
5. 调用 POST /api/v1/imports/:sessionId
6. 依靠去重吸收重叠数据
7. 更新本地游标
```

---

## 媒体附件（协议预留）

当前版本重点保证文本消息的导入稳定性。`attachments` 作为协议预留字段：调用方可在消息中携带该字段，ChatLab 当前接收但不承诺完整落库与渲染。

预留字段结构见 [ChatLab 格式规范](./chatlab-format.md)。

---

## 错误码与重试策略

| 错误码 | HTTP 状态 | 说明 | 可重试 |
| --- | --- | --- | --- |
| `UNAUTHORIZED` | 401 | Token 无效或缺失 | 否 |
| `INVALID_FORMAT` | 400 | Content-Type 不支持或请求体格式错误 | 否 |
| `INVALID_PAYLOAD` | 400 | 必填字段缺失、类型错误或校验失败 | 否 |
| `BODY_TOO_LARGE` | 413 | JSON body 超过 50MB | 否 |
| `IMPORT_IN_PROGRESS` | 409 | 当前有其他导入正在执行 | 是 |
| `IDEMPOTENCY_CONFLICT` | 409 | 相同幂等键但请求体不一致 | 否 |
| `IMPORT_FAILED` | 500 | 导入过程内部错误 | 是 |
| `SERVER_ERROR` | 500 | 服务内部错误 | 是 |

**重试策略建议：**

```
最大重试次数：3
退避策略：指数退避 + 随机抖动
  第 1 次重试：5s + random(0, 1s)
  第 2 次重试：15s + random(0, 3s)
  第 3 次重试：45s + random(0, 5s)
重试时必须使用相同的 Idempotency-Key
```

---

## 版本与兼容性

- `chatlab.version`：`0.0.2`
- API 路径前缀：`/api/v1`
- **向后兼容**：新增字段均为可选，不破坏旧调用方
- **字段废弃策略**：废弃字段先标记为 `deprecated`，保留两个版本后移除
- **平台标识可扩展**：`platform` 字段不限于预定义枚举，可传入任意小写字母标识

---

## 相关文档

- [ChatLab API 文档](./chatlab-api.md) — 查询、导出和系统端点
- [Pull 远程数据源协议](./chatlab-pull.md) — 第三方暴露标准端点，ChatLab 主动拉取
- [ChatLab 标准化格式规范](./chatlab-format.md) — 数据交换格式定义
