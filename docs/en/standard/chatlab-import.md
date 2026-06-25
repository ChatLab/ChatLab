---
outline: deep
---

# Push Import Protocol

> v1

This document defines the standard import protocol for external data sources to push chat data into ChatLab. It covers three scenarios: initial full import, historical backfill, and periodic incremental sync.

::: tip Two Import Modes

- **Push mode** (this document): The external system actively pushes data to ChatLab's import endpoint. Suitable for script integrations and one-time file imports.
- **[Pull mode](./chatlab-pull.md)**: A third-party exposes standard HTTP endpoints and ChatLab pulls data on demand. **The recommended integration approach for third-party tools.**

Both modes share the same underlying import pipeline (deduplication, meta/members update, FTS indexing). Data format is unified as [ChatLab Format](./chatlab-format.md).

:::

## Design Principles

1. **Single endpoint**: Initial and incremental imports use the same endpoint — callers don't need to distinguish.
2. **Minimal surface**: 1 import endpoint + 2 query endpoints cover all Push scenarios.
3. **Two-layer idempotency**: Request-level (`Idempotency-Key`) + record-level dedup (`platformMessageId` / content hash), guaranteeing **at-least-once + deterministic dedupe**.
4. **Synchronous by default**: Small batches return `200 OK` with write results synchronously.
5. **Auto-update by default**: `meta` and `members` are updated automatically with each import request; controllable via `options`.

---

## Basics

### Base URL

```
Base URL: http://<host>:<port>   (desktop default: 127.0.0.1:3110)
Prefix:   /api/v1
```

### Authentication

All requests must include a Bearer Token:

```
Authorization: Bearer <token>
```

Tokens are generated in ChatLab settings and are formatted as `clb_` + 64 hex characters.

### Content-Type

```
application/json    # Standard JSON body (≤50MB)
```

---

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/v1/imports/:sessionId` | Import messages into a session (auto-creates on first import, appends on subsequent calls) |
| `GET` | `/api/v1/sessions/:id` | Query session status (for reconciliation) |
| `GET` | `/api/v1/sessions` | List all sessions (for discovering target sessions) |

For query endpoint details, see [ChatLab API](./chatlab-api.md).

---

## POST /api/v1/imports/:sessionId

**The single import entry point.** Creates the session if it doesn't exist; appends data and updates meta/members if it does.

### Path Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `sessionId` | string | Session ID, generated and maintained by the caller. Must remain stable for the same chat source across batches. See generation strategy below. |

**Session ID Generation Strategy:**

| Priority | Scenario | Recommended Format | Example |
| --- | --- | --- | --- |
| 1 (preferred) | Platform-native ID available | `{platform}_{originalId}` | `whatsapp_112233445566`, `qq_123456789` |
| 2 | File import (structured ID available) | `{platform}_{meta.groupId}` or `{platform}_{platformId}` | `whatsapp_112233445566` |
| 3 | File import (no structured identifier) | `file_{SHA256(content)[:16]}` | `file_a1b2c3d4e5f6g7h8` |
| 4 (fallback) | One-off import | `import_{UUID}` | `import_550e8400-e29b-41d4-a716-446655440000` |

::: warning
- Avoid using file paths as sessionId input — renaming the file changes the sessionId.
- The same sessionId **must** be used for both the initial import and all subsequent incremental imports for the same chat source.
:::

### Request Headers

| Header | Required | Description |
| --- | --- | --- |
| `Authorization` | Yes | `Bearer <token>` |
| `Content-Type` | Yes | `application/json` |
| `Idempotency-Key` | Recommended | Unique identifier for the current batch, for safe retries. Suggested format: `{sessionId}-{batchIndex}-{windowStart}` |

### Quick Test

Copy the command below to test immediately (replace `YOUR_TOKEN` and the port with your actual values):

```bash
curl http://127.0.0.1:3110/api/v1/imports/group_abc123 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
  "chatlab": { "version": "0.0.2", "exportedAt": 1711468800, "generator": "test" },
  "meta": { "name": "Product Discussion", "platform": "whatsapp", "type": "group", "groupId": "112233445566" },
  "members": [
    { "platformId": "user_a", "accountName": "Alice", "roles": [{ "id": "owner" }] }
  ],
  "messages": [
    { "platformMessageId": "msg_1001", "sender": "user_a", "timestamp": 1711468800, "type": 0, "content": "Hello" }
  ]
}'
```

A successful response returns `"success": true` with write statistics. Repeating the same `platformMessageId` is deduplicated — `duplicateCount` increases while `writtenCount` stays the same.

---

### Request Body (JSON)

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1711468800,
    "generator": "YourSystem/1.0"
  },
  "meta": {
    "name": "Product Discussion",
    "platform": "whatsapp",
    "type": "group",
    "groupId": "112233445566",
    "groupAvatar": "data:image/jpeg;base64,...",
    "ownerId": "user_owner"
  },
  "members": [
    {
      "platformId": "user_a",
      "accountName": "Alice",
      "groupNickname": "Product",
      "avatar": "data:image/jpeg;base64,...",
      "roles": [{ "id": "owner" }]
    }
  ],
  "messages": [
    {
      "platformMessageId": "msg_1001",
      "sender": "user_a",
      "accountName": "Alice",
      "groupNickname": "Product",
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

### options Object (Optional)

| Field | Type | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `metaUpdateMode` | string | `patch` | `patch` / `none` | `patch`: overwrite non-empty fields; `none`: skip update |
| `memberUpdateMode` | string | `upsert` | `upsert` / `none` | `upsert`: insert + update; `none`: skip update |

::: tip
When backfilling historical data, pass `"metaUpdateMode": "none"` to prevent old group names from overwriting the current value.
:::

### Block Requirements

| Block | First Import | Incremental Import | Notes |
| --- | --- | --- | --- |
| `chatlab` | Required | Optional | First use creates the session; subsequent use for version compatibility |
| `meta` | Required | Optional | First use sets initial values; subsequent use patches non-empty fields |
| `members` | Required | Optional | First use writes all members; subsequent use upserts by `platformId` |
| `messages` | Required | Required | Every batch must include at least one message |

**Meta Auto-Update Rules:**

- Fields provided by the caller with non-empty values → overwrite
- Fields not provided or empty → keep existing value
- `platform` and `type` cannot be updated after session creation

**Members Upsert Rules:**

- Matched by `platformId`: new `platformId` → insert; existing → update non-empty fields
- If `members` is omitted: unknown `sender` values in messages are auto-created as members (with minimal info only)

---

### Field Definitions

#### chatlab Object

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `version` | string | Yes | Format version, currently `"0.0.2"` |
| `exportedAt` | number | Yes | Export/generation time (Unix timestamp in seconds) |
| `generator` | string | No | Name of the generating tool or system |

#### meta Object

| Field | Type | Required (first import) | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Group or conversation name |
| `platform` | string | Yes | Platform identifier (see enum below) |
| `type` | string | Yes | Conversation type: `group` or `private` |
| `groupId` | string | No | Platform-native group ID |
| `groupAvatar` | string | No | Group avatar as base64 Data URL or network URL |
| `ownerId` | string | No | `platformId` of the exporter/owner |

**Platform Identifier Enum:**

| Value | Platform |
| --- | --- |
| `wechat` | WeChat |
| `qq` | QQ |
| `telegram` | Telegram |
| `discord` | Discord |
| `whatsapp` | WhatsApp |
| `line` | LINE |
| `slack` | Slack |
| `unknown` | Unknown / Other |

::: tip
If your platform isn't listed, use a lowercase identifier (e.g. `signal`, `matrix`). ChatLab will apply the `unknown` analysis strategy.
:::

#### members Array Elements

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `platformId` | string | Yes | Member's unique platform identifier |
| `accountName` | string | Recommended | Account name (original nickname, unchanged across groups) |
| `groupNickname` | string | No | Group-specific nickname |
| `avatar` | string | No | Avatar as base64 Data URL or network URL |
| `roles` | array | No | Role list, see [Role Definitions](./chatlab-format.md) |

#### messages Array Elements

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `sender` | string | Yes | Sender's `platformId` or reserved identifier (e.g. `SYSTEM`) |
| `timestamp` | number | Yes | Message timestamp (Unix seconds) |
| `type` | number | Yes | Message type enum (see [Message Types](./chatlab-format.md)) |
| `accountName` | string | Recommended | Account name at the time of sending |
| `groupNickname` | string | No | Group nickname at the time of sending |
| `content` | string\|null | No | Plain text content; can be null for non-text messages |
| `platformMessageId` | string | Strongly recommended | Platform-native message ID, the preferred deduplication key |
| `replyToMessageId` | string | No | `platformMessageId` of the message being replied to |

**sender Field Rules:**

1. Must be a stable `platformId` or the reserved identifier `SYSTEM`
2. If `sender` is not in `members`, ChatLab auto-creates the member with minimal info
3. `SYSTEM` is for system messages (join/leave/announcements) and is excluded from member statistics

---

### Success Response

```json
{
  "success": true,
  "data": {
    "sessionId": "group_abc123",
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

| Field | Description |
| --- | --- |
| `created` | `true` if this request triggered session creation (first import) |
| `batch.receivedCount` | Number of messages received in this batch |
| `batch.writtenCount` | Number of messages actually written |
| `batch.duplicateCount` | Number of messages skipped due to deduplication |
| `session.totalCount` | Total message count in the session after this write |
| `session.memberCount` | Total member count in the session |
| `session.firstTimestamp` | Earliest message timestamp in the session |
| `session.lastTimestamp` | Latest message timestamp in the session |
| `updates.metaUpdated` | Whether meta was updated by this request |
| `updates.membersAdded` | Number of new members added |
| `updates.membersUpdated` | Number of existing members updated |

---

## Deduplication

Deduplication is scoped to a single session and does not cross sessions.

**Priority:**

1. If `platformMessageId` is provided, it is used as the unique key (high precision, recommended).
2. If `platformMessageId` is absent, falls back to content hash: `sha256(timestamp + '\0' + sender + '\0' + contentTag + '\0' + normalizedContent)`

| Layer | Mechanism | Scope | Precision |
| --- | --- | --- | --- |
| Request-level idempotency | `Idempotency-Key` | Retries of the same HTTP request | Exact |
| Message-level dedup (primary) | `platformMessageId` | Same message across batches/windows | Exact |
| Message-level dedup (fallback) | Content hash | Fallback when `platformMessageId` is absent | Best effort |

::: warning
- A message with the same `platformMessageId` will not be written again, even if `content` differs (first write wins).
- Content hash dedup treats "same sender, same second, identical content" as a duplicate; there is a very small false positive rate.
- **Strongly recommended**: provide `platformMessageId` — it is the most reliable deduplication key.
:::

---

## Batching

### Recommended Batch Size

**5,000 messages per batch.**

| Constraint | Value | Notes |
| --- | --- | --- |
| JSON body size limit | 50MB | Exceeding returns `BODY_TOO_LARGE` (413) |
| Recommended batch size | 5,000 messages | Balances performance and memory |

### Batching Rules

- Send batches in chronological order, oldest first
- Overlapping time windows between batches are allowed (5–10 minutes recommended); deduplication handles the overlap
- Each batch is an independent request; a failed batch does not affect others
- The first batch must include `chatlab` + `meta` + `members` (triggers session creation)
- Subsequent batches may include `messages` only

### Cursor Maintenance (caller's responsibility)

ChatLab does not maintain cursors for callers. Recommended structure:

```json
{
  "sessionId": "group_abc123",
  "lastSyncedTimestamp": 1711468800,
  "lastSyncedMessageId": "msg_900000"
}
```

After each successful batch, update the cursor with `session.lastTimestamp` from the response. On failure, keep the cursor unchanged and retry with the same `Idempotency-Key`.

### Concurrency

Current version: **only one import task is allowed at a time per session**. Concurrent requests to the same sessionId return `IMPORT_IN_PROGRESS` (409); imports to different sessions run independently.

---

## Standard Workflows

### Initial Full Import (Bootstrap)

```
1. Prepare all chat data and split into N batches in chronological order (≤5,000 messages each)

2. First batch:
   POST /api/v1/imports/group_abc123
   Body: { chatlab, meta, members, messages }
   → Response: created: true, session created

3. Batches 2–N:
   POST /api/v1/imports/group_abc123
   Body: { messages }
   Idempotency-Key: {sessionId}-{batchIndex}-{windowStart}

4. After each batch, record cursor; on failure, retry with the same Idempotency-Key

5. After all batches, reconcile:
   GET /api/v1/sessions/group_abc123
   → Verify totalCount, firstTimestamp, lastTimestamp
```

### Historical Backfill

```
1. Identify the time range [start, end] to fill
2. Split into batches by time window
3. Call POST /api/v1/imports/:sessionId for each batch
   (Recommended: set options.metaUpdateMode: "none" to prevent old names overwriting current)
4. Update local cursor after each successful batch
5. Optional: GET /api/v1/sessions/:id for reconciliation
```

### Scheduled Incremental Sync

```
1. Fixed sessionId + scheduler (e.g. hourly/daily)
2. Start from last cursor, with 5–10 minutes of overlap as the window start
3. Fetch new messages in that time window
4. If there are new members or name changes, include meta/members
5. Call POST /api/v1/imports/:sessionId
6. Deduplication absorbs overlapping data
7. Update local cursor
```

---

## Media Attachments (Reserved)

The current version focuses on stable text message import. `attachments` is a reserved protocol field: callers may include it in messages, but ChatLab does not guarantee full persistence or rendering in this version.

See [ChatLab Format Specification](./chatlab-format.md) for the reserved field structure.

---

## Error Codes and Retry Strategy

| Error Code | HTTP Status | Description | Retryable |
| --- | --- | --- | --- |
| `UNAUTHORIZED` | 401 | Invalid or missing token | No |
| `INVALID_FORMAT` | 400 | Unsupported Content-Type or malformed body | No |
| `INVALID_PAYLOAD` | 400 | Missing required fields, type errors, or validation failures | No |
| `BODY_TOO_LARGE` | 413 | JSON body exceeds 50MB | No |
| `IMPORT_IN_PROGRESS` | 409 | Another import is currently running | Yes |
| `IDEMPOTENCY_CONFLICT` | 409 | Same idempotency key but different request body | No |
| `IMPORT_FAILED` | 500 | Internal error during import | Yes |
| `SERVER_ERROR` | 500 | Internal server error | Yes |

**Recommended Retry Strategy:**

```
Max retries: 3
Backoff: exponential + random jitter
  Retry 1: 5s + random(0, 1s)
  Retry 2: 15s + random(0, 3s)
  Retry 3: 45s + random(0, 5s)
Always reuse the same Idempotency-Key on retry
```

---

## Versioning and Compatibility

- `chatlab.version`: `0.0.2`
- API path prefix: `/api/v1`
- **Backward compatible**: all new fields are optional and do not break existing callers
- **Deprecation policy**: deprecated fields are marked first, kept for two versions, then removed
- **Extensible platform identifiers**: `platform` is not limited to the predefined enum; any lowercase identifier is accepted

---

## Related Docs

- [ChatLab API](./chatlab-api.md) — Query, export, and system endpoints
- [Pull Remote Data Source Protocol](./chatlab-pull.md) — Third-party exposes endpoints; ChatLab pulls
- [ChatLab Standard Format Specification](./chatlab-format.md) — Data interchange format definition
