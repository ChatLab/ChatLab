# ChatLab API Documentation

ChatLab provides a local RESTful API service that allows external tools, scripts, and MCP to query chat records, execute SQL queries, and import chat data via HTTP.

## Quick Start

### 1. Enable the Service

Open ChatLab → Settings → ChatLab API → Enable Service.

Once enabled, an API Token is automatically generated. The default port is `5200`.

### 2. Verify Service Status

```bash
curl http://127.0.0.1:5200/api/v1/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Response example:

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

## General Information

| Item | Description |
|------|-------------|
| Base URL | `http://127.0.0.1:5200` |
| API Prefix | `/api/v1` |
| Authentication | Bearer Token |
| Data Format | JSON |
| Bind Address | `127.0.0.1` (localhost only) |

### Authentication

All requests must include the `Authorization` header:

```
Authorization: Bearer clb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The Token can be viewed and regenerated in Settings → ChatLab API.

### Unified Response Format

**Success response:**

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

**Error response:**

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

## Endpoint List

### System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/status` | Service status |
| GET | `/api/v1/schema` | ChatLab Format JSON Schema |

### Data Query (Export)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/sessions` | List all sessions |
| GET | `/api/v1/sessions/:id` | Get single session details |
| GET | `/api/v1/sessions/:id/messages` | Query messages (paginated) |
| GET | `/api/v1/sessions/:id/members` | Get member list |
| GET | `/api/v1/sessions/:id/stats/overview` | Get overview statistics |
| POST | `/api/v1/sessions/:id/sql` | Execute custom SQL (read-only) |
| GET | `/api/v1/sessions/:id/export` | Export ChatLab Format JSON |

### Data Import

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/import` | Import chat records (new session) |
| POST | `/api/v1/sessions/:id/import` | Incremental import to existing session |

---

## Endpoint Details

### GET /api/v1/status

Get the running status of the API service.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Service name (`ChatLab API`) |
| `version` | string | ChatLab application version |
| `uptime` | number | Service uptime in seconds |
| `sessionCount` | number | Total number of sessions |

---

### GET /api/v1/schema

Get the JSON Schema definition for ChatLab Format, useful for building compliant import data.

---

### GET /api/v1/sessions

Get all imported sessions.

**Response example:**

```json
{
  "success": true,
  "data": [
    {
      "id": "session_abc123",
      "name": "Tech Discussion Group",
      "platform": "wechat",
      "type": "group",
      "messageCount": 58000,
      "memberCount": 120
    }
  ]
}
```

---

### GET /api/v1/sessions/:id

Get detailed information for a single session.

**Path parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |

---

### GET /api/v1/sessions/:id/messages

Query messages from a specific session with pagination and filtering support.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 100 | Items per page (max 1000) |
| `startTime` | number | - | Start timestamp (Unix seconds) |
| `endTime` | number | - | End timestamp (Unix seconds) |
| `keyword` | string | - | Keyword search |
| `senderId` | string | - | Filter by sender's platformId |
| `type` | number | - | Filter by message type |

**Request example:**

```bash
curl "http://127.0.0.1:5200/api/v1/sessions/abc123/messages?page=1&limit=50&keyword=hello" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "senderPlatformId": "123456",
        "senderName": "John",
        "timestamp": 1703001600,
        "type": 0,
        "content": "Hello!"
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

Get all members of a specific session.

---

### GET /api/v1/sessions/:id/stats/overview

Get overview statistics for a specific session.

**Response:**

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
        "name": "John",
        "messageCount": 5800,
        "percentage": 10.0
      }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `messageCount` | Total message count |
| `memberCount` | Total member count |
| `timeRange` | Earliest/latest message timestamps (Unix seconds) |
| `messageTypeDistribution` | Count per message type (key is [message type](./chatlab-format.md#message-type-reference) enum value) |
| `topMembers` | Top 10 active members (sorted by message count descending) |

---

### POST /api/v1/sessions/:id/sql

Execute a read-only SQL query against a specific session's database. Only `SELECT` statements are allowed.

**Request body:**

```json
{
  "sql": "SELECT sender, COUNT(*) as count FROM messages GROUP BY sender ORDER BY count DESC LIMIT 10"
}
```

**Response:**

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

> For database schema details, refer to ChatLab internal documentation or use `SELECT * FROM sqlite_master WHERE type='table'` to inspect the tables.

---

### GET /api/v1/sessions/:id/export

Export complete session data in [ChatLab Format](./chatlab-format.md) JSON.

**Limit:** Maximum **100,000 messages** per export. If the session exceeds this limit, a `400 EXPORT_TOO_LARGE` error is returned. For larger sessions, use the paginated `/messages` API.

**Response:**

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
      "name": "Tech Discussion Group",
      "platform": "wechat",
      "type": "group"
    },
    "members": [...],
    "messages": [...]
  }
}
```

---

### POST /api/v1/import

Import chat records into ChatLab, **creating a new session**.

#### Supported Content-Types

| Content-Type | Format | Use Case | Body Limit |
|------|------|------|------|
| `application/json` | ChatLab Format JSON | Small to medium data (quick testing, script integration) | **50MB** |
| `application/x-ndjson` | ChatLab JSONL format | Large-scale data (production integration) | **Unlimited** |

#### JSON Mode Example

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
      "name": "Import Test",
      "platform": "qq",
      "type": "group"
    },
    "members": [
      { "platformId": "123", "accountName": "Test User" }
    ],
    "messages": [
      {
        "sender": "123",
        "accountName": "Test User",
        "timestamp": 1711468800,
        "type": 0,
        "content": "Hello World"
      }
    ]
  }'
```

#### JSONL Mode Example

```bash
cat data.jsonl | curl -X POST http://127.0.0.1:5200/api/v1/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @-
```

**Response:**

```json
{
  "success": true,
  "data": {
    "mode": "new",
    "sessionId": "session_xyz789"
  }
}
```

> For the full ChatLab Format specification, see [ChatLab Format Specification](./chatlab-format.md).

---

### POST /api/v1/sessions/:id/import

**Incrementally import** chat records into an existing session. Duplicate messages are automatically skipped.

**Deduplication rules:**

The unique key for each message is `timestamp + senderPlatformId + contentLength`. If a message's timestamp, sender, and content length match an existing message exactly, it is considered a duplicate and skipped.

**Path parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Target session ID |

Content-Type and request body format are the same as `POST /api/v1/import`.

**Response:**

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

## Concurrency & Limits

| Limit | Value | Description |
|-------|-------|-------------|
| JSON body size | 50MB | `application/json` mode |
| JSONL body size | Unlimited | `application/x-ndjson` streaming mode |
| Export message limit | 100,000 | `/export` endpoint |
| Max page size | 1,000 | `/messages` endpoint |
| Import concurrency | 1 | Only one import operation allowed at a time |

---

## Error Codes

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing token |
| `SESSION_NOT_FOUND` | 404 | Session not found |
| `INVALID_FORMAT` | 400 | Request body does not conform to ChatLab Format |
| `SQL_READONLY_VIOLATION` | 400 | SQL is not a SELECT statement |
| `SQL_EXECUTION_ERROR` | 400 | SQL execution error |
| `EXPORT_TOO_LARGE` | 400 | Message count exceeds export limit (100K) |
| `BODY_TOO_LARGE` | 413 | Request body exceeds 50MB (JSON mode only) |
| `IMPORT_IN_PROGRESS` | 409 | Another import is already in progress |
| `IMPORT_FAILED` | 500 | Import failed |
| `SERVER_ERROR` | 500 | Internal server error |

---

## Security

- **Localhost only**: API binds to `127.0.0.1`, not exposed to the network
- **Token authentication**: All endpoints require a valid Bearer Token
- **Read-only SQL**: `/sql` endpoint only allows `SELECT` queries
- **Disabled by default**: API service must be manually enabled

---

## Use Cases

### 1. MCP Integration

Connect the ChatLab API to AI tools like Claude Desktop, enabling AI to directly query and analyze chat records.

### 2. Automation Scripts

Write scripts to periodically export chat records from other platforms, convert to ChatLab Format, and automatically import via the Push API.

### 3. Data Analysis

Use the SQL endpoint to run custom queries, combined with Python/R for advanced data analysis.

### 4. Data Backup

Periodically export important session data via the `/export` endpoint as JSON backups.

### 5. Scheduled Pulling

Configure external data source URLs in the Settings page. ChatLab will automatically fetch and import new data at the configured interval.

---

## Version History

| Version | Description |
|---------|-------------|
| v1 | Initial release — session query, message search, SQL, export, import (JSON + JSONL), Pull scheduler |
