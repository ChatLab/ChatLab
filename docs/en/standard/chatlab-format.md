---
outline: deep
---

# ChatLab Standard Format Specification v0.0.1

ChatLab defines a standard chat record data exchange format to support unified import and analysis of multi-platform data.

As long as you convert your chat records to this format, ChatLab can parse and analyze them.

::: warning Notice
This format specification is still in its early development stage. Some fields and structures may be adjusted in future versions.
:::

## Overview

### Supported File Formats

| Format    | Extension | Use Case                                                    |
| --------- | --------- | ----------------------------------------------------------- |
| **JSON**  | `.json`   | Small to medium records (<1 million), clear structure       |
| **JSONL** | `.jsonl`  | Very large records (>1 million), streaming, constant memory |

### Format Comparison

| Feature         | JSON                            | JSONL                           |
| --------------- | ------------------------------- | ------------------------------- |
| Memory Usage    | Requires loading full structure | Line-by-line, constant (~100MB) |
| File Size Limit | ~1GB (depends on memory)        | No practical limit              |
| Append Writing  | Requires rewriting entire file  | ✅ Direct line append           |
| Error Recovery  | Single error invalidates file   | Can skip error lines            |
| Readability     | ⭐⭐⭐ Easy to read             | ⭐⭐ One record per line        |
| Recommended For | Small/medium (<1M records)      | Large (>1M records)             |

## Quick Start

Here's a **minimal** ChatLab format example with only required fields:

```json
{
  "chatlab": {
    "version": "0.0.1",
    "exportedAt": 1703001600
  },
  "meta": {
    "name": "My Group Chat",
    "platform": "qq",
    "type": "group"
  },
  "members": [
    {
      "platformId": "123456",
      "accountName": "John"
    }
  ],
  "messages": [
    {
      "sender": "123456",
      "accountName": "John",
      "timestamp": 1703001600,
      "type": 0,
      "content": "Hello everyone!"
    }
  ]
}
```

---

## JSON Format Detailed Specification

### File Header (chatlab)

| Field         | Type   | Required | Description                             |
| ------------- | ------ | -------- | --------------------------------------- |
| `version`     | string | ✅       | Format version, currently `"0.0.1"`     |
| `exportedAt`  | number | ✅       | Export time (Unix timestamp in seconds) |
| `generator`   | string | -        | Generator tool name                     |
| `description` | string | -        | Description                             |

### Metadata (meta)

| Field         | Type   | Required | Description                                                         |
| ------------- | ------ | -------- | ------------------------------------------------------------------- |
| `name`        | string | ✅       | Group name or conversation name                                     |
| `platform`    | string | ✅       | Platform identifier: `qq` / `wechat` / `discord` / `whatsapp`, etc. |
| `type`        | string | ✅       | Chat type: `group` / `private`                                      |
| `groupId`     | string | -        | Group ID (group chat only)                                          |
| `groupAvatar` | string | -        | Group avatar (Data URL format)                                      |

### Members (members)

| Field           | Type     | Required | Description                   |
| --------------- | -------- | -------- | ----------------------------- |
| `platformId`    | string   | ✅       | User unique identifier        |
| `accountName`   | string   | ✅       | Account name                  |
| `groupNickname` | string   | -        | Group nickname (group only)   |
| `aliases`       | string[] | -        | User-defined aliases          |
| `avatar`        | string   | -        | User avatar (Data URL format) |

### Messages (messages)

| Field           | Type           | Required | Description                           |
| --------------- | -------------- | -------- | ------------------------------------- |
| `sender`        | string         | ✅       | Sender's `platformId`                 |
| `accountName`   | string         | ✅       | Account name when sending             |
| `groupNickname` | string         | -        | Group nickname when sending           |
| `timestamp`     | number         | ✅       | Unix timestamp in seconds             |
| `type`          | number         | ✅       | Message type (see table below)        |
| `content`       | string \| null | ✅       | Message content (`null` for non-text) |

---

## Message Type Reference

::: warning Tip
If you have other special types in your chat records that need support, please submit an issue explaining your situation. We'll evaluate whether to add them to the standard message types.
:::

### Basic Message Types (0-19)

| Value | Name     | Description   |
| ----- | -------- | ------------- |
| 0     | TEXT     | Text message  |
| 1     | IMAGE    | Image         |
| 2     | VOICE    | Voice         |
| 3     | VIDEO    | Video         |
| 4     | FILE     | File          |
| 5     | EMOJI    | Emoji/Sticker |
| 7     | LINK     | Link/Card     |
| 8     | LOCATION | Location      |

### Interactive Message Types (20-39)

| Value | Name       | Description                       |
| ----- | ---------- | --------------------------------- |
| 20    | RED_PACKET | Red packet                        |
| 21    | TRANSFER   | Transfer                          |
| 22    | POKE       | Poke/Nudge                        |
| 23    | CALL       | Voice/Video call                  |
| 24    | SHARE      | Share (music, mini program, etc.) |
| 25    | REPLY      | Quote reply                       |
| 26    | FORWARD    | Forward message                   |
| 27    | CONTACT    | Contact card                      |

### System Message Types (80+)

| Value | Name   | Description                              |
| ----- | ------ | ---------------------------------------- |
| 80    | SYSTEM | System message (join/leave/announcement) |
| 81    | RECALL | Recalled message                         |
| 99    | OTHER  | Other/Unknown                            |

## Avatar Format

The `avatar` and `groupAvatar` fields use **Data URL** format:

```
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...
```

Supported image formats:

- `image/jpeg` - JPEG format (recommended, smaller size)
- `image/png` - PNG format
- `image/gif` - GIF format
- `image/webp` - WebP format

::: tip Suggestion
When exporting, we recommend compressing avatars to 100×100 pixels or less to reduce file size.
:::

## Complete Examples

### Group Chat Example (with optional fields)

```json
{
  "chatlab": {
    "version": "0.0.1",
    "exportedAt": 1703001600,
    "generator": "My Converter Tool",
    "description": "2024 Tech Exchange Group Chat Backup"
  },
  "meta": {
    "name": "Tech Exchange Group",
    "platform": "wechat",
    "type": "group",
    "groupId": "38988428513",
    "groupAvatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
  },
  "members": [
    {
      "platformId": "abc123",
      "accountName": "John",
      "groupNickname": "Admin-John",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    },
    {
      "platformId": "def456",
      "accountName": "Jane",
      "groupNickname": "Moderator",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    }
  ],
  "messages": [
    {
      "sender": "abc123",
      "accountName": "John",
      "groupNickname": "Admin-John",
      "timestamp": 1703001600,
      "type": 0,
      "content": "Hello everyone! Welcome to the Tech Exchange Group~"
    },
    {
      "sender": "def456",
      "accountName": "Jane",
      "groupNickname": "Moderator",
      "timestamp": 1703001610,
      "type": 1,
      "content": "[Image: screenshot.jpg]"
    }
  ]
}
```

### Private Chat Example

```json
{
  "chatlab": {
    "version": "0.0.1",
    "exportedAt": 1703001600
  },
  "meta": {
    "name": "Conversation with Mike",
    "platform": "qq",
    "type": "private"
  },
  "members": [
    {
      "platformId": "123456789",
      "accountName": "Me",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    },
    {
      "platformId": "987654321",
      "accountName": "Mike",
      "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    }
  ],
  "messages": [
    {
      "sender": "123456789",
      "accountName": "Me",
      "timestamp": 1703001600,
      "type": 0,
      "content": "Hey, are you there?"
    }
  ]
}
```

## JSONL Streaming Format

JSONL (JSON Lines) format is suitable for **very large chat records** (>1 million messages) to avoid memory overflow issues.

### Format Features

- One JSON object per line
- Distinguish line types by `_type` field: `header` / `member` / `message`
- Constant memory usage (~100MB), supports GB-level files
- Supports streaming writes, can append while exporting

### Line Type Description

| `_type`   | Description                           | Required              |
| --------- | ------------------------------------- | --------------------- |
| `header`  | File header with `chatlab` and `meta` | ✅ Must be first line |
| `member`  | Member information                    | - Optional            |
| `message` | Message record                        | ✅ At least one       |

### Complete Example

```jsonl
{"_type":"header","chatlab":{"version":"0.0.1","exportedAt":1703001600},"meta":{"name":"Tech Exchange Group","platform":"qq","type":"group"}}
{"_type":"member","platformId":"123456","accountName":"John","groupNickname":"Admin"}
{"_type":"member","platformId":"789012","accountName":"Jane"}
{"_type":"message","sender":"123456","accountName":"John","groupNickname":"Admin","timestamp":1703001600,"type":0,"content":"Hello everyone!"}
{"_type":"message","sender":"789012","accountName":"Jane","timestamp":1703001610,"type":0,"content":"Hi there!"}
{"_type":"message","sender":"123456","accountName":"John","groupNickname":"Admin","timestamp":1703001620,"type":1,"content":"[Image]"}
```

### Parsing Rules

1. **First line must be header**: Contains `chatlab` version and `meta` information
2. **Member lines before messages**: Optional; if omitted, member info will be collected from messages
3. **Messages sorted by time**: Recommended to sort by `timestamp` in ascending order
4. **Each line is independent**: Single line parsing errors can be skipped
5. **Comment lines supported**: Lines starting with `#` are skipped (can be used for notes)

::: warning Notice

- Each line must be **valid JSON** (cannot span lines)
- Lines are separated by newline `\n` :::

## Version History

| Version | Date    | Changes         |
| ------- | ------- | --------------- |
| 0.0.1   | 2025-12 | Initial version |
