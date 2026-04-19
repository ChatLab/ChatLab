---
outline: deep
---

# ChatLab API

> v1

ChatLab 提供本地 RESTful API 服务，允许外部工具、脚本和 MCP 等通过 HTTP 接口查询聊天记录、执行 SQL 查询、导出聊天数据。

::: tip 数据导入

如需通过 API 导入聊天数据，请参阅：

- **[Push 导入协议](./chatlab-import.md)** — 外部系统主动将数据推送到 ChatLab
- **[Pull 远程数据源协议](./chatlab-pull.md)** — 第三方暴露标准端点，ChatLab 主动拉取数据

:::

## 快速开始

### 1. 启用服务

打开 ChatLab → 设置 → ChatLab API → 开启服务。

启用后会自动生成 API Token，默认监听端口 `5200`。

### 2. 验证服务状态

```bash
curl http://127.0.0.1:5200/api/v1/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

响应示例：

```json
{
  "success": true,
  "data": {
    "name": "ChatLab API",
    "version": "1.0.0",
    "uptime": 3600,
    "sessionCount": 5
  },
  "meta": {
    "timestamp": 1711468800,
    "version": "0.0.2"
  }
}
```

## 基本信息

| 项目     | 说明                      |
| -------- | ------------------------- |
| 基础 URL | `http://127.0.0.1:5200`   |
| API 前缀 | `/api/v1`                 |
| 认证方式 | Bearer Token              |
| 数据格式 | JSON                      |
| 绑定地址 | `127.0.0.1`（仅本机访问） |

### 认证

所有请求必须携带 `Authorization` 请求头：

```
Authorization: Bearer clb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Token 可在 设置 → ChatLab API 页面查看和重新生成。

### 统一响应格式

**成功响应：**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": 1711468800,
    "version": "0.0.2"
  }
}
```

**错误响应：**

```json
{
  "success": false,
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session not found: abc123"
  }
}
```

---

## 端点列表

### 系统

| 方法 | 路径             | 说明                       |
| ---- | ---------------- | -------------------------- |
| GET  | `/api/v1/status` | 服务状态                   |
| GET  | `/api/v1/schema` | ChatLab Format JSON Schema |

### 数据查询与导出

| 方法 | 路径                                  | 说明                     |
| ---- | ------------------------------------- | ------------------------ |
| GET  | `/api/v1/sessions`                    | 获取所有会话列表         |
| GET  | `/api/v1/sessions/:id`                | 获取单个会话详情         |
| GET  | `/api/v1/sessions/:id/messages`       | 查询消息（分页）         |
| GET  | `/api/v1/sessions/:id/members`        | 获取成员列表             |
| GET  | `/api/v1/sessions/:id/stats/overview` | 获取概览统计             |
| POST | `/api/v1/sessions/:id/sql`            | 执行自定义 SQL（只读）   |
| GET  | `/api/v1/sessions/:id/export`         | 导出 ChatLab Format JSON |

### 数据导入

| 方法 | 路径                                 | 说明                                                     | 文档                             |
| ---- | ------------------------------------ | -------------------------------------------------------- | -------------------------------- |
| POST | `/api/v1/imports/:sessionId`         | 导入消息到指定会话（首次自动创建，后续追加）             | [Push 导入协议](./chatlab-import.md) |

---

## 端点详细说明

### GET /api/v1/status

获取 API 服务的运行状态。

**响应：**

| 字段           | 类型   | 说明                      |
| -------------- | ------ | ------------------------- |
| `name`         | string | 服务名称（`ChatLab API`） |
| `version`      | string | ChatLab 应用版本          |
| `uptime`       | number | 服务运行时间（秒）        |
| `sessionCount` | number | 当前会话总数              |

---

### GET /api/v1/schema

获取 ChatLab Format 的 JSON Schema 定义，便于构建符合规范的导入数据。

---

### GET /api/v1/sessions

获取所有已导入的会话列表。

**响应示例：**

```json
{
  "success": true,
  "data": [
    {
      "id": "session_abc123",
      "name": "技术交流群",
      "platform": "qq",
      "type": "group",
      "messageCount": 58000,
      "memberCount": 120,
      "lastTimestamp": 1711468800
    }
  ]
}
```

---

### GET /api/v1/sessions/:id

获取单个会话的详细信息。

**路径参数：**

| 参数 | 类型   | 说明    |
| ---- | ------ | ------- |
| `id` | string | 会话 ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "id": "wechat_xxx@chatroom",
    "name": "产品讨论群",
    "platform": "wechat",
    "type": "group",
    "messageCount": 58000,
    "memberCount": 86,
    "firstTimestamp": 1609459200,
    "lastTimestamp": 1711468800,
    "lastPlatformMessageId": "msg_900000",
    "groupId": "xxx@chatroom",
    "importedAt": 1711469900
  }
}
```

| 字段                    | 类型         | 说明                                                   |
| ----------------------- | ------------ | ------------------------------------------------------ |
| `messageCount`          | number       | 会话内消息总数                                         |
| `memberCount`           | number       | 成员总数                                               |
| `firstTimestamp`        | number\|null | 最早消息时间戳（秒级 Unix）                            |
| `lastTimestamp`         | number\|null | 最新消息时间戳（秒级 Unix）                            |
| `lastPlatformMessageId` | string\|null | 最新一条有 platformMessageId 的消息 ID（用于增量边界） |
| `importedAt`            | number       | 最后一次导入时间                                       |

---

### GET /api/v1/sessions/:id/messages

分页查询指定会话的消息列表，支持多种过滤条件。

**查询参数：**

| 参数        | 类型   | 默认值 | 说明                     |
| ----------- | ------ | ------ | ------------------------ |
| `page`      | number | 1      | 页码                     |
| `limit`     | number | 100    | 每页条数（最大 1000）    |
| `startTime` | number | -      | 起始时间戳（秒级 Unix）  |
| `endTime`   | number | -      | 结束时间戳（秒级 Unix）  |
| `keyword`   | string | -      | 关键词搜索               |
| `senderId`  | string | -      | 按发送者 ID 筛选         |

**请求示例：**

```bash
curl "http://127.0.0.1:5200/api/v1/sessions/abc123/messages?page=1&limit=50&keyword=你好" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**响应：**

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "senderPlatformId": "123456",
        "senderName": "张三",
        "timestamp": 1703001600,
        "type": 0,
        "content": "你好！"
      }
    ],
    "total": 1500,
    "page": 1,
    "limit": 50,
    "totalPages": 30
  }
}
```

---

### GET /api/v1/sessions/:id/members

获取指定会话的所有成员列表。

---

### GET /api/v1/sessions/:id/stats/overview

获取指定会话的概览统计信息。

**响应：**

```json
{
  "success": true,
  "data": {
    "messageCount": 58000,
    "memberCount": 120,
    "timeRange": {
      "start": 1609459200,
      "end": 1703001600
    },
    "messageTypeDistribution": {
      "0": 45000,
      "1": 8000,
      "5": 3000,
      "80": 2000
    },
    "topMembers": [
      {
        "platformId": "123456",
        "name": "张三",
        "messageCount": 5800,
        "percentage": 10.0
      }
    ]
  }
}
```

| 字段                      | 说明                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- |
| `messageCount`            | 总消息数                                                                         |
| `memberCount`             | 成员数                                                                           |
| `timeRange`               | 最早/最新消息时间戳（秒级 Unix）                                                 |
| `messageTypeDistribution` | 各消息类型的数量（key 为 [消息类型](./chatlab-format.md#消息类型对照表) 枚举值） |
| `topMembers`              | 前 10 活跃成员（按消息数降序）                                                   |

---

### POST /api/v1/sessions/:id/sql

对指定会话的数据库执行只读 SQL 查询。仅允许 `SELECT` 语句。

**请求体：**

```json
{
  "sql": "SELECT sender_id, COUNT(*) as count FROM message GROUP BY sender_id ORDER BY count DESC LIMIT 10"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "columns": ["sender_id", "count"],
    "rows": [
      [1, 5800],
      [2, 3200]
    ]
  }
}
```

::: tip 提示
使用 `SELECT * FROM sqlite_master WHERE type='table'` 查询可用的数据库表结构。
:::

---

### GET /api/v1/sessions/:id/export

导出完整会话数据，格式为 [ChatLab Format](./chatlab-format.md) JSON。

**限制：** 最多导出 **10 万条** 消息。如果会话消息数超过此限制，返回 `400 EXPORT_TOO_LARGE` 错误。超大会话建议使用 `/messages` 分页 API 逐页获取。

**响应：**

```json
{
  "success": true,
  "data": {
    "chatlab": {
      "version": "0.0.2",
      "exportedAt": 1711468800,
      "generator": "ChatLab API"
    },
    "meta": {
      "name": "技术交流群",
      "platform": "qq",
      "type": "group"
    },
    "members": [...],
    "messages": [...]
  }
}
```

---

## 并发与限制

| 限制项           | 值      | 说明                            |
| ---------------- | ------- | ------------------------------- |
| JSON 请求体大小  | 50MB    | `application/json` 模式         |
| JSONL 请求体大小 | 无限制  | `application/x-ndjson` 流式模式 |
| 导出消息上限     | 10 万条 | `/export` 端点                  |
| 分页最大每页     | 1000 条 | `/messages` 端点                |
| 导入并发         | 1       | 同一时刻仅允许一个导入操作      |

---

## 错误码

| 错误码                   | HTTP 状态码 | 说明                                |
| ------------------------ | ----------- | ----------------------------------- |
| `UNAUTHORIZED`           | 401         | Token 无效或缺失                    |
| `SESSION_NOT_FOUND`      | 404         | 会话不存在                          |
| `INVALID_FORMAT`         | 400         | Content-Type 不支持或请求体格式错误 |
| `INVALID_PAYLOAD`        | 400         | 必填字段缺失、类型错误或校验失败   |
| `SQL_READONLY_VIOLATION` | 400         | SQL 不是 SELECT 语句                |
| `SQL_EXECUTION_ERROR`    | 400         | SQL 执行出错                        |
| `EXPORT_TOO_LARGE`       | 400         | 消息数超过导出上限（10 万条）       |
| `BODY_TOO_LARGE`         | 413         | 请求体超过 50MB（仅 JSON 模式）     |
| `IMPORT_IN_PROGRESS`     | 409         | 有其他导入正在进行                  |
| `IDEMPOTENCY_CONFLICT`   | 409         | 相同幂等键但请求体不一致           |
| `IMPORT_FAILED`          | 500         | 导入失败                            |
| `SERVER_ERROR`           | 500         | 服务内部错误                        |

---

## 安全说明

- **仅本机访问**：API 绑定 `127.0.0.1`，不对外暴露
- **Token 认证**：所有端点需携带有效 Bearer Token
- **SQL 只读限制**：`/sql` 端点仅允许 `SELECT` 查询
- **默认关闭**：API 服务需手动开启

---

## 使用场景

### 1. MCP 集成

将 ChatLab API 接入 Claude Desktop 等 AI 工具，实现 AI 对聊天记录的直接查询和分析。

### 2. 自动化导入

编写脚本定期从其他平台导出聊天记录，转换为 ChatLab Format 后通过 [Push 导入协议](./chatlab-import.md) 自动导入。

### 3. 数据分析

通过 SQL 端点执行自定义查询，配合 Python/R 等工具进行高级数据分析。

### 4. 数据备份

通过 `/export` 端点定期导出重要会话数据作为 JSON 备份。

### 5. 远程数据源

在设置页配置外部数据源 URL，ChatLab 按 [Pull 远程数据源协议](./chatlab-pull.md) 自动拉取并导入新数据。

---

## 版本信息

| 版本 | 说明                                                                           |
| ---- | ------------------------------------------------------------------------------ |
| v1   | 支持会话查询、消息搜索、SQL、导出、Push 导入（JSON + JSONL）、Pull 远程数据源 |

---

## 相关文档

- [ChatLab 标准化格式规范](./chatlab-format.md) — 数据交换格式定义
- [Push 导入协议](./chatlab-import.md) — 外部系统主动推送数据到 ChatLab
- [Pull 远程数据源协议](./chatlab-pull.md) — 第三方暴露标准端点，ChatLab 主动拉取
