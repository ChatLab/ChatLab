---
outline: deep
---

# Pull Remote Data Source Protocol

> v1

This document defines the protocol for third-party data sources to expose standard HTTP endpoints that ChatLab pulls from. This is the **recommended integration approach** for the ChatLab ecosystem.

::: tip Two Import Modes

- **[Push mode](./chatlab-import.md)**: The external system actively pushes data to ChatLab's import endpoint. Suitable for script integrations and one-time file imports.
- **Pull mode** (this document): A third-party exposes standard HTTP endpoints and ChatLab pulls data on demand. **The recommended integration approach.**

:::

## Why Pull is Recommended

- Third-party tools are data producers — exposing data is their natural role. ChatLab is the consumer/analyzer — pulling data is its natural role.
- Users only need to enter a data source URL in the ChatLab UI to browse, select, and sync — the entire operation happens within ChatLab.
- Push mode requires third parties to implement HTTP client logic (batch management, retries, cursor maintenance), which has a higher implementation cost.
- The Pull protocol defines a **general data exposure standard**, not just for ChatLab — any compatible tool can integrate with it.

**Suitable scenarios:**

- The external collector runs on a remote device and only needs to expose an HTTP endpoint
- Users want to browse available conversations in the ChatLab UI, select what to import, and click "Sync Now"
- Long-running scenarios that need scheduled automatic incremental sync

---

## Overview

The Pull mode workflow has three phases:

```
1. Discovery: ChatLab retrieves the list of all available conversations from the data source
2. Pull: After the user selects conversations, ChatLab fetches the message history
3. Sync: Scheduled incremental pulls for new messages (optional SSE real-time notifications for lower latency)
```

Third-party data sources only need to implement the standard HTTP endpoints defined here. ChatLab (and any future compatible tools) will automatically handle discovery, full pull, and incremental sync.

---

## Phase 1: Discover Available Conversations

After connecting to a remote data source, ChatLab first fetches the list of all pullable conversations.

### GET /sessions

```
GET {baseUrl}/sessions
Authorization: Bearer {token}     ← only included if a token is configured
Accept: application/json
```

**Optional parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `keyword` | string | Fuzzy search by conversation name. Search semantics are defined server-side; fuzzy match on `name` is recommended, optionally extending to `id`. |
| `limit` | number | Maximum number of results. If omitted, returns all results; if the server supports pagination, a reasonable cap is recommended. |
| `cursor` | string | Pagination cursor. Only used when the server supports paginated discovery. Must restart from the first page when `keyword` changes. |

**Response:**

```json
{
  "sessions": [
    {
      "id": "112233445566",
      "name": "Product Discussion",
      "platform": "whatsapp",
      "type": "group",
      "messageCount": 58000,
      "memberCount": 86,
      "lastMessageAt": 1711468800
    },
    {
      "id": "user_a",
      "name": "Alice",
      "platform": "whatsapp",
      "type": "private",
      "messageCount": 1200,
      "memberCount": 2,
      "lastMessageAt": 1711465200
    }
  ],
  "page": {
    "hasMore": true,
    "nextCursor": "eyJsYXN0TWVzc2FnZUF0IjoxNzExNDY1MjAwLCJpZCI6Ind4aWRfZnJpZW5kX2EifQ=="
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Unique conversation identifier in the data source |
| `name` | string | Yes | Conversation name (group name or contact name) |
| `platform` | string | Yes | Platform identifier (same as Push mode) |
| `type` | string | Yes | `group` or `private` |
| `messageCount` | number | No | Total message count (shown in ChatLab UI as an estimate) |
| `memberCount` | number | No | Member count |
| `lastMessageAt` | number | No | Latest message timestamp |

`page` is an **optional enhancement field**:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `hasMore` | boolean | No | Whether more pages exist. Only returned when the server supports paginated discovery. |
| `nextCursor` | string | No | Cursor for the next page. Should be returned when `hasMore=true`; the client passes it back verbatim. |

**Compatibility rules:**

- Older servers can continue returning only `{ "sessions": [...] }` without `page`.
- When ChatLab receives a response without a `page` field, it treats the result as a complete single-page response.
- When `page` is present, ChatLab can offer manual "load more" or auto-continue, depending on the product interaction.
- ChatLab currently recommends manual "load more" in the UI, advancing via `hasMore / nextCursor`.

**Pagination consistency recommendations:**

- Servers should maintain stable page order; a fixed sort (e.g. `lastMessageAt desc, id asc`) is recommended.
- `cursor` must be bound to the current query; whenever `keyword` changes, the old `cursor` should be considered invalid.
- Avoid `offset`-based pagination on the `/sessions` discovery endpoint to prevent duplicates or gaps when the list changes.

ChatLab displays this list in the UI and the user selects which conversations to import.

---

## Phase 2: Pull Conversation Data

After the user selects a conversation, ChatLab fetches its data.

### GET /sessions/:id/messages

```
GET {baseUrl}/sessions/{sessionId}/messages?format=chatlab&since={timestamp}
Authorization: Bearer {token}
Accept: application/json
```

| Parameter | Required | Description |
| --- | --- | --- |
| `sessionId` | Yes | Conversation `id` from Phase 1 |
| `format` | Yes | Fixed as `chatlab`; requests ChatLab standard format from the data source |
| `since` | No | Unix timestamp (seconds). Omitted or `0` = full pull; greater than 0 = incremental pull |
| `limit` | No | Maximum messages per response, for pagination |

::: tip Future Evolution
A future version may support `Accept: application/x-ndjson` for NDJSON streaming responses. Current version uses JSON only.
:::

### Data Carrying Rules

- **Initial full pull** (`since` is absent or 0): **Must** include `chatlab` + `meta` + `members` + `messages`
- **Incremental sync** (`since > 0`): **Must** include `messages`. `meta` / `members` should **only be included when they have actually changed**; omit them otherwise to avoid overwriting current state with historical snapshots
- Return an empty `messages` array when there is no new data

::: tip Data Preparation
If the data source needs time to prepare data for a `since=0` request (e.g. loading from disk, building indexes), it may return an empty `messages` + `hasMore: false`. ChatLab will retry automatically (up to 3 times with increasing intervals) while waiting for the data source to be ready.
:::

### Response Format

The response is standard [ChatLab Format](./chatlab-format.md) (JSON or JSONL), plus a `sync` metadata block.

```json
{
  "chatlab": { "version": "0.0.2", "exportedAt": 1711468800 },
  "meta": { "name": "Product Discussion", "platform": "whatsapp", "type": "group" },
  "members": [ ... ],
  "messages": [ ... ],
  "sync": {
    "hasMore": true,
    "nextSince": 1711468800
  }
}
```

### sync Metadata

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `hasMore` | boolean | **Yes** | Whether more data exists. When `true`, ChatLab automatically continues pulling. |
| `nextSince` | number | **Yes** | Suggested `since` value for the next request (typically the timestamp of the last message in this batch). |

ChatLab's pagination is driven entirely by `hasMore` + `nextSince`. After returning a batch, the data source sets `nextSince` to the last message's timestamp; ChatLab passes that value as `since` on the next request. ChatLab's built-in deduplication handles any overlap at timestamp boundaries correctly.

::: details Reserved Protocol Fields (not used in current version)
The following fields are reserved in the protocol. ChatLab does not currently use them but may enable them in future versions:

| Field | Type | Description |
| --- | --- | --- |
| `nextOffset` | number | Pagination offset, used with the `offset` parameter |
| `watermark` | number | Snapshot upper-bound timestamp for pagination consistency |

Data sources do not need to implement these fields. ChatLab's deduplication (based on `platformMessageId` or content hash) already ensures data integrity.
:::

**sync Block Requirements:**

| Data Source Behavior | sync Block | Notes |
| --- | --- | --- |
| Returns all data in one response (no pagination) | Optional | ChatLab treats `messages` as the complete result |
| Supports `limit`-based pagination | **Required** | Must include at least `hasMore` + `nextSince` |

::: warning
If a data source supports pagination but does not return a `sync` block, ChatLab does not guarantee automatic continuation — only the first response will be processed.
:::

### Batch Pull Strategy

For large histories (e.g. tens of thousands of messages), the recommended batching approach:

**Timestamp-chained batching** (recommended): Use `since` + `limit` to pull in batches. The data source returns the next request's start timestamp via `sync.nextSince`, and ChatLab automatically continues until `hasMore=false`.

```
Page 1: GET /sessions/:id/messages?format=chatlab&since=0&limit=1000
  → Returns 1000 messages, sync: { hasMore: true, nextSince: 1711400000 }

Page 2: GET /sessions/:id/messages?format=chatlab&since=1711400000&limit=1000
  → Returns 1000 messages, sync: { hasMore: true, nextSince: 1711440000 }

Page N: ...
  → Returns 500 messages, sync: { hasMore: false, nextSince: 1711468800 }
```

ChatLab's built-in deduplication ensures no duplicate writes, even if there is message overlap at `nextSince` boundaries.

---

## Phase 3: Scheduled Incremental Sync

ChatLab periodically performs incremental pulls on subscribed conversations at the user-configured interval:

```
GET {baseUrl}/sessions/{sessionId}/messages?format=chatlab&since={lastPullAt}
```

The remote data source returns incremental messages since `lastPullAt`. ChatLab processes them through the internal import pipeline (deduplication, meta/members update, FTS indexing — all the same as Push mode).

---

## Optional: SSE Real-Time Notifications

In addition to scheduled polling, a remote data source may optionally implement an SSE (Server-Sent Events) endpoint to **notify ChatLab that new data is available**.

::: warning Important
SSE is a notification channel only, not the primary data sync channel. ChatLab does not assume SSE events are reliably delivered (network drops and process restarts can cause missed events). Final data consistency is always guaranteed by scheduled pulls. SSE reduces incremental sync latency from minutes to seconds.
:::

### GET /push/messages

```
GET {baseUrl}/push/messages
Authorization: Bearer {token}
Accept: text/event-stream
```

**Event format:**

```
event: message.new
data: {"eventId":"evt_001","sessionId":"112233445566","timestamp":1711468800}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `eventId` | string | Yes | Unique event ID, used by ChatLab to deduplicate already-processed notifications |
| `sessionId` | string | Yes | ID of the conversation that has new messages |
| `timestamp` | number | Yes | Timestamp of the new message |
| `platformMessageId` | string | No | Platform-native message ID (if available) |

When ChatLab receives an SSE event, it **triggers one incremental pull for that session** (calling `GET /sessions/:id/messages?format=chatlab&since={lastPullAt}`), rather than writing the event data directly to storage.

---

## Authentication

Remote data sources may optionally require authentication. If needed, use `Authorization: Bearer {token}`.

::: tip SSE Authentication
Some data sources additionally support the `?access_token=TOKEN` query parameter for passing tokens (recommended for SSE long connections, since the `EventSource` API does not support custom headers). ChatLab also supports the query parameter approach when connecting to SSE.
:::

---

## Implementation Guide

### Minimal Implementation (2 endpoints)

Only two endpoints are needed to integrate with ChatLab:

| Endpoint | Description |
| --- | --- |
| `GET /sessions` | Returns the conversation list |
| `GET /sessions/:id/messages?format=chatlab&since=X` | Returns data in ChatLab format |

A minimal implementation does not require pagination, SSE, or a complex `sync` block. ChatLab treats the response's `messages` as the complete dataset.

### Enhanced Implementation

| Capability | Description |
| --- | --- |
| `GET /push/messages` | SSE real-time notifications (wakes up a pull; does not transmit data directly) |
| `limit` + `sync` pagination | Batched pulling for large histories via `hasMore` + `nextSince` |

### Data Format

All data responses must conform to the [ChatLab Standard Format Specification](./chatlab-format.md) (JSON or JSONL), including the four standard blocks: `chatlab`, `meta`, `members`, and `messages`.

### Media Files

If messages in the data source contain media references, `attachments` fields (`filePath` or `dataUri`) may point to media endpoints on the data source. ChatLab currently treats this as a reserved protocol field; future versions will support pulling media files from the data source.

---

## Example Scenario

A collector running on a phone continuously captures WeChat messages and exposes `GET /sessions` and `GET /sessions/:id/messages`. The user operates in ChatLab:

```
1. Add a remote data source in ChatLab settings (enter collector URL + optional token)

2. ChatLab calls GET {baseUrl}/sessions
   → Displays 86 groups and 200 private chats

3. User selects 5 groups to import

4. ChatLab immediately performs a full pull:
   GET {baseUrl}/sessions/{id}/messages?format=chatlab&since=0
   → If sync.hasMore=true, auto-continues until complete

5. Hourly incremental sync thereafter:
   GET {baseUrl}/sessions/{id}/messages?format=chatlab&since={lastPullAt}

6. If the collector implements SSE:
   On receiving a message.new event → immediately trigger an incremental pull (no waiting for the timer)

7. User can click "Sync Now" in the ChatLab UI at any time
```

---

## Related Docs

- [ChatLab API](./chatlab-api.md) — Query, export, and system endpoints
- [Push Import Protocol](./chatlab-import.md) — External system actively pushes data to ChatLab
- [ChatLab Standard Format Specification](./chatlab-format.md) — Data interchange format definition
