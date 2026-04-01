# ChatLab API 文档

ChatLab 提供本地 RESTful API 服务，允许外部工具、脚本和 MCP 等通过 HTTP 接口查询聊天记录、执行 SQL 查询、导入聊天数据。

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

### 数据查询（导出）

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

| 方法 | 路径                          | 说明                     |
| ---- | ----------------------------- | ------------------------ |
| POST | `/api/v1/import`              | 导入聊天记录（新建会话） |
| POST | `/api/v1/sessions/:id/import` | 增量导入到指定会话       |

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
      "memberCount": 120
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
| `senderId`  | string | -      | 按发送者 platformId 筛选 |
| `type`      | number | -      | 按消息类型筛选           |

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
  "sql": "SELECT sender, COUNT(*) as count FROM messages GROUP BY sender ORDER BY count DESC LIMIT 10"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "columns": ["sender", "count"],
    "rows": [
      ["123456", 5800],
      ["789012", 3200]
    ]
  }
}
```

> 关于数据库表结构，请参考 ChatLab 内部文档或使用 `SELECT * FROM sqlite_master WHERE type='table'` 查询。

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

### POST /api/v1/import

将聊天记录导入 ChatLab，**创建新会话**。

#### 支持的 Content-Type

| Content-Type           | 格式                | 适用场景                       | Body 限制  |
| ---------------------- | ------------------- | ------------------------------ | ---------- |
| `application/json`     | ChatLab Format JSON | 中小数据（快速测试、脚本集成） | **50MB**   |
| `application/x-ndjson` | ChatLab JSONL 格式  | 大规模数据（生产级集成）       | **无限制** |

#### JSON 模式示例

```bash
curl -X POST http://127.0.0.1:5200/api/v1/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chatlab": {
      "version": "0.0.2",
      "exportedAt": 1711468800
    },
    "meta": {
      "name": "导入测试",
      "platform": "qq",
      "type": "group"
    },
    "members": [
      { "platformId": "123", "accountName": "测试用户" }
    ],
    "messages": [
      {
        "sender": "123",
        "accountName": "测试用户",
        "timestamp": 1711468800,
        "type": 0,
        "content": "Hello World"
      }
    ]
  }'
```

#### JSONL 模式示例

```bash
cat data.jsonl | curl -X POST http://127.0.0.1:5200/api/v1/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @-
```

**响应：**

```json
{
  "success": true,
  "data": {
    "mode": "new",
    "sessionId": "session_xyz789"
  }
}
```

> 关于 ChatLab Format 的详细规范，请参考 [ChatLab 标准化格式规范](./chatlab-format.md)。

---

### POST /api/v1/sessions/:id/import

将聊天记录**增量导入**到已存在的会话。支持去重，相同消息不会重复插入。

**去重规则：**

消息唯一键为 `timestamp + senderPlatformId + contentLength`。如果一条消息的时间戳、发送者和内容长度与已有消息完全相同，则视为重复并跳过。

**路径参数：**

| 参数 | 类型   | 说明        |
| ---- | ------ | ----------- |
| `id` | string | 目标会话 ID |

Content-Type 和请求体格式与 `POST /api/v1/import` 相同。

**响应：**

```json
{
  "success": true,
  "data": {
    "mode": "incremental",
    "sessionId": "session_abc123",
    "newMessageCount": 150
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

| 错误码                   | HTTP 状态码 | 说明                            |
| ------------------------ | ----------- | ------------------------------- |
| `UNAUTHORIZED`           | 401         | Token 无效或缺失                |
| `SESSION_NOT_FOUND`      | 404         | 会话不存在                      |
| `INVALID_FORMAT`         | 400         | 请求体不符合 ChatLab Format     |
| `SQL_READONLY_VIOLATION` | 400         | SQL 不是 SELECT 语句            |
| `SQL_EXECUTION_ERROR`    | 400         | SQL 执行出错                    |
| `EXPORT_TOO_LARGE`       | 400         | 消息数超过导出上限（10 万条）   |
| `BODY_TOO_LARGE`         | 413         | 请求体超过 50MB（仅 JSON 模式） |
| `IMPORT_IN_PROGRESS`     | 409         | 有其他导入正在进行              |
| `IMPORT_FAILED`          | 500         | 导入失败                        |
| `SERVER_ERROR`           | 500         | 服务内部错误                    |

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

### 2. 自动化脚本

编写脚本定期从其他平台导出聊天记录，转换为 ChatLab Format 后通过 Push API 自动导入。

### 3. 数据分析

通过 SQL 端点执行自定义查询，配合 Python/R 等工具进行高级数据分析。

### 4. 数据备份

通过 `/export` 端点定期导出重要会话数据作为 JSON 备份。

### 5. 定时拉取

在设置页配置外部数据源 URL，ChatLab 会按设定间隔自动拉取并导入新数据。

---

## 版本信息

| 版本 | 说明                                                                           |
| ---- | ------------------------------------------------------------------------------ |
| v1   | 初始版本，支持会话查询、消息搜索、SQL、导出、导入（JSON + JSONL）、Pull 调度器 |
