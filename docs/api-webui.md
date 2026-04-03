# ChatLab Web UI API 文档

## 概述

ChatLab Web UI API 提供了基于 Fastify 的 HTTP API 服务，支持 Web UI 访问 ChatLab 数据。所有 API 端点都需要 Bearer Token 认证。

### 服务配置

- **端口**: 默认 9871（可配置）
- **主机**: 127.0.0.1（本地连接）
- **认证**: JWT Bearer Token（7天过期）
- **速率限制**: 登录失败 5 次锁定 15 分钟

### 日志记录

所有操作都有完整的日志记录，格式：
```
[WebUI API] [ISO_TIMESTAMP] OPERATION_NAME - Context details: {...}
```

日志级别：
- `INFO`: 正常操作（登录、列表、创建等）
- `WARN`: 认证失败、不存在的资源等
- `ERROR`: 系统错误、数据库错误等

---

## 认证 API

### 登录 - POST `/api/webui/auth/login`

用户登录并获取 JWT Token。

**请求:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": 1704067200000
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**失败响应:**
- **400**: 缺少凭证
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_FORMAT",
      "message": "Username and password are required"
    }
  }
  ```

- **401**: 凭证错误或超过速率限制
  ```json
  {
    "success": false,
    "error": {
      "code": "LOGIN_FAILED",
      "message": "Invalid username or password"
    }
  }
  ```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] LOGIN_ATTEMPT - User: admin
[WebUI API] [2024-01-01T00:00:00Z] LOGIN_SUCCESS - User: admin: {token: "...", expiresAt: "2024-01-08..."}
```

---

### 登出 - POST `/api/webui/auth/logout`

用户登出，清除服务器端 Token 记录（可选）。

**请求头:**
```
Authorization: Bearer <token>
```

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "success": true
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**失败响应:**
- **401**: 无效或缺少 Token
  ```json
  {
    "success": false,
    "error": {
      "code": "UNAUTHORIZED",
      "message": "Invalid or missing token"
    }
  }
  ```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] LOGOUT - User logged out
```

---

## 会话 API

### 列表会话 - GET `/api/webui/sessions`

获取所有分析会话列表。

**请求头:**
```
Authorization: Bearer <token>
```

**成功响应 (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "session-123",
      "name": "WeChat Group Chat",
      "description": "Group chat analysis",
      "createdAt": 1704067200000,
      "updatedAt": 1704153600000,
      "messageCount": 5234
    }
  ],
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] LIST_SESSIONS - Retrieving all sessions
[WebUI API] [2024-01-01T00:00:00Z] LIST_SESSIONS_SUCCESS - Found 3 sessions: {sessionIds: ["session-123", ...]}
```

---

### 获取单个会话 - GET `/api/webui/sessions/:sessionId`

获取特定会话的详细信息。

**请求头:**
```
Authorization: Bearer <token>
```

**请求参数:**
- `sessionId` (path): 会话 ID

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "id": "session-123",
    "name": "WeChat Group Chat",
    "description": "Group chat analysis",
    "createdAt": 1704067200000,
    "updatedAt": 1704153600000,
    "messageCount": 5234
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**失败响应:**
- **404**: 会话不存在
  ```json
  {
    "success": false,
    "error": {
      "code": "SESSION_NOT_FOUND",
      "message": "Session not found: invalid-id"
    }
  }
  ```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] GET_SESSION - Session: session-123
[WebUI API] [2024-01-01T00:00:00Z] GET_SESSION_SUCCESS - Session: session-123: {name: "WeChat Group Chat", messageCount: 5234}
```

---

## 对话 API

### 创建对话 - POST `/api/webui/conversations`

在指定会话中创建新的 AI 对话。

**请求头:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体:**
```json
{
  "sessionId": "session-123",
  "title": "Chat Analysis Discussion",
  "assistantId": "default"
}
```

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "id": "conv-456",
    "sessionId": "session-123",
    "title": "Chat Analysis Discussion",
    "assistantId": "default",
    "createdAt": 1704153600000,
    "updatedAt": 1704153600000
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2",
    "conversationId": "conv-456"
  }
}
```

**失败响应:**
- **404**: 会话不存在
  ```json
  {
    "success": false,
    "error": {
      "code": "SESSION_NOT_FOUND",
      "message": "Session not found: invalid-session-id"
    }
  }
  ```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] CREATE_CONVERSATION - Session: session-123: {title: "Chat Analysis", assistantId: "default"}
[WebUI API] [2024-01-01T00:00:00Z] CREATE_CONVERSATION_SUCCESS - Conversation: conv-456: {sessionId: "session-123", title: "Chat Analysis"}
```

---

### 列表对话 - GET `/api/webui/sessions/:sessionId/conversations`

列出会话中的所有对话。

**请求头:**
```
Authorization: Bearer <token>
```

**请求参数:**
- `sessionId` (path): 会话 ID

**成功响应 (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "conv-456",
      "sessionId": "session-123",
      "title": "Chat Analysis Discussion",
      "assistantId": "default",
      "createdAt": 1704153600000,
      "updatedAt": 1704153600000
    }
  ],
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] LIST_CONVERSATIONS - Session: session-123
[WebUI API] [2024-01-01T00:00:00Z] LIST_CONVERSATIONS_SUCCESS - Session: session-123: {count: 2}
```

---

### 删除对话 - DELETE `/api/webui/conversations/:conversationId`

删除指定的对话及其所有消息。

**请求头:**
```
Authorization: Bearer <token>
```

**请求参数:**
- `conversationId` (path): 对话 ID

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "success": true
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**失败响应:**
- **404**: 对话不存在
  ```json
  {
    "success": false,
    "error": {
      "code": "CONVERSATION_NOT_FOUND",
      "message": "Conversation not found: invalid-conv-id"
    }
  }
  ```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] DELETE_CONVERSATION - Conversation: conv-456
[WebUI API] [2024-01-01T00:00:00Z] DELETE_CONVERSATION_SUCCESS - Conversation: conv-456
```

---

## 消息 API

### 发送消息 - POST `/api/webui/conversations/:conversationId/messages`

在对话中发送用户消息。

**请求头:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求参数:**
- `conversationId` (path): 对话 ID

**请求体:**
```json
{
  "content": "What are the most common topics in this chat?"
}
```

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "id": "msg-789",
    "conversationId": "conv-456",
    "role": "user",
    "content": "What are the most common topics in this chat?",
    "timestamp": 1704153600000
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**失败响应:**
- **400**: 内容为空
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_FORMAT",
      "message": "Message content cannot be empty"
    }
  }
  ```

- **404**: 对话不存在
  ```json
  {
    "success": false,
    "error": {
      "code": "CONVERSATION_NOT_FOUND",
      "message": "Conversation not found: invalid-conv-id"
    }
  }
  ```

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] SEND_MESSAGE - Conversation: conv-456: {contentLength: 42}
[WebUI API] [2024-01-01T00:00:00Z] SEND_MESSAGE_SUCCESS - Conversation: conv-456: {messageId: "msg-789", contentLength: 42}
```

---

### 获取消息 - GET `/api/webui/conversations/:conversationId/messages`

获取对话中的消息列表（分页）。

**请求头:**
```
Authorization: Bearer <token>
```

**请求参数:**
- `conversationId` (path): 对话 ID
- `limit` (query, optional): 每页消息数，默认 20，最大 100
- `offset` (query, optional): 偏移量，默认 0

**成功响应 (200):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg-789",
        "conversationId": "conv-456",
        "role": "user",
        "content": "What are the most common topics?",
        "timestamp": 1704153600000
      },
      {
        "id": "msg-790",
        "conversationId": "conv-456",
        "role": "assistant",
        "content": "Based on the analysis...",
        "timestamp": 1704153601000
      }
    ],
    "total": 42,
    "offset": 0,
    "limit": 20
  },
  "meta": {
    "timestamp": 1704153600,
    "version": "0.0.2"
  }
}
```

**查询参数示例:**
- `?limit=10&offset=0` - 获取前 10 条消息
- `?limit=50&offset=100` - 获取第 101-150 条消息

**日志示例:**
```
[WebUI API] [2024-01-01T00:00:00Z] GET_MESSAGES - Conversation: conv-456: {limit: 20, offset: 0}
[WebUI API] [2024-01-01T00:00:00Z] GET_MESSAGES_SUCCESS - Conversation: conv-456: {total: 42, returned: 20, offset: 0, limit: 20}
```

---

## 错误处理

所有 API 错误响应都遵循统一格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### 常见错误码

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | `INVALID_FORMAT` | 请求参数格式错误 |
| 401 | `UNAUTHORIZED` | 缺少或无效的 Token |
| 401 | `LOGIN_FAILED` | 登录失败（凭证错误或速率限制） |
| 404 | `SESSION_NOT_FOUND` | 会话不存在 |
| 404 | `CONVERSATION_NOT_FOUND` | 对话不存在 |
| 500 | `SERVER_ERROR` | 服务器内部错误 |

---

## 示例使用

### JavaScript/TypeScript

```typescript
// 导入 API 客户端
import { getApiClient } from '@/api/client'

const client = getApiClient({ baseURL: 'http://127.0.0.1:9871' })

// 登录
const loginResult = await client.login({
  username: 'admin',
  password: 'admin123'
})

if (loginResult.success) {
  // 创建对话
  const convResult = await client.createConversation({
    sessionId: 'session-123',
    title: 'My Conversation'
  })

  // 发送消息
  await client.sendMessage({
    conversationId: convResult.conversation!.id,
    content: 'Hello, AI!'
  })

  // 获取消息
  const messages = await client.getMessages({
    conversationId: convResult.conversation!.id,
    limit: 20,
    offset: 0
  })

  console.log(messages)
}
```

### cURL

```bash
# 登录
curl -X POST http://127.0.0.1:9871/api/webui/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# 列出会话（需要 token）
curl -X GET http://127.0.0.1:9871/api/webui/sessions \
  -H "Authorization: Bearer <token>"

# 创建对话
curl -X POST http://127.0.0.1:9871/api/webui/conversations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-123", "title": "Test"}'

# 发送消息
curl -X POST http://127.0.0.1:9871/api/webui/conversations/conv-456/messages \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello!"}'

# 获取消息
curl -X GET 'http://127.0.0.1:9871/api/webui/conversations/conv-456/messages?limit=20&offset=0' \
  -H "Authorization: Bearer <token>"
```

---

## 安全建议

1. **生产环境**: 使用 HTTPS 而非 HTTP
2. **密钥管理**: 定期修改默认凭证 (admin/admin123)
3. **Token 过期**: Token 有效期为 7 天，过期后需重新登录
4. **速率限制**: 登录失败 5 次会被锁定 15 分钟
5. **访问控制**: 仅允许本地 (127.0.0.1) 访问，生产环境考虑反向代理
6. **日志审计**: 定期检查日志文件以发现异常活动

---

## 调试

### 启用详细日志

在 Electron 主进程设置：
```typescript
console.log = console.warn = console.error = (msg: string) => {
  // 写入日志文件
  fs.appendFileSync('api.log', `${new Date().toISOString()} ${msg}\n`)
}
```

### 常见问题

**Q: 如何重置 Token?**
A: Token 保存在客户端。清除 localStorage 或重新登录即可。

**Q: 如何修改默认凭证?**
A: 编辑 `{userData}/api-auth.json` 文件。

**Q: 如何修改 API 端口?**
A: 在应用设置中修改 API 端口设置，并重启服务器。

---

## 版本历史

### v0.0.2
- 初始 Web UI API 实现
- 支持 JWT Token 认证
- 完整的对话和消息管理
- 全面的日志记录
