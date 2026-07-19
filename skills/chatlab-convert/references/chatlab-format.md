# ChatLab conversion contract

Use this contract when generating ChatLab Format `0.0.2`. It is intentionally limited to what a converter needs. The ChatLab CLI or this Skill's bundled strict validator is authoritative for generated files:

```bash
chatlab validate "/absolute/path/to/output.jsonl" --json
node "/absolute/path/to/chatlab-convert/scripts/validate-chatlab.mjs" "/absolute/path/to/output.jsonl"
```

Choose one command based on the environment; running both is unnecessary. The bundled validator checks the format only and does not replace import validation with `chatlab import --dry-run --json`.

## Core invariants

- One output file represents exactly one conversation.
- Use UTF-8. Use Unix timestamps in integer **seconds**, never milliseconds.
- `meta.type` is `group` or `private`. Use a stable lowercase platform slug such as `qq`, `weixin`, or the source product name.
- `sender` and `ownerId` refer to a member `platformId`.
- Preserve every source record. Map an unrecognized message to type `99`; do not discard it.
- Preserve original member and message IDs when available. IDs are strings even when the source uses numbers.
- `platformMessageId` is optional but must be unique when present. `replyToMessageId` refers to one of those IDs.
- Order messages by `timestamp` ascending. Preserve a stable source ordinal when timestamps are equal.
- Keep `accountName` as the account-level display name and `groupNickname` as the conversation-specific name.

## Preferred JSONL shape

Write one compact JSON object per line. The first non-comment data line is one `header`, followed by all `member` lines, followed by `message` lines.

```jsonl
{"_type":"header","chatlab":{"version":"0.0.2","exportedAt":1711468800,"generator":"local-converter"},"meta":{"name":"Example chat","platform":"example","type":"group","groupId":"group-1","ownerId":"member-1"}}
{"_type":"member","platformId":"member-1","accountName":"Alice","groupNickname":"Alice","aliases":["A"],"roles":[{"id":"owner"}]}
{"_type":"member","platformId":"member-2","accountName":"Bob"}
{"_type":"message","platformMessageId":"message-1","sender":"member-1","accountName":"Alice","groupNickname":"Alice","timestamp":1711468800,"type":0,"content":"Hello"}
{"_type":"message","platformMessageId":"message-2","replyToMessageId":"message-1","sender":"member-2","accountName":"Bob","timestamp":1711468810,"type":25,"content":"Reply"}
```

Blank and `#` comment lines are accepted, but converters should normally omit them. Member lines are optional only when the export has no member metadata. If any member lines are emitted, emit every sender before the first message.

## JSON shape

Use JSON only when the complete output is safely held in memory. `members` and `messages` are required arrays.

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1711468800,
    "generator": "local-converter"
  },
  "meta": {
    "name": "Example chat",
    "platform": "example",
    "type": "private",
    "ownerId": "member-1"
  },
  "members": [
    { "platformId": "member-1", "accountName": "Alice" },
    { "platformId": "member-2", "accountName": "Bob" }
  ],
  "messages": [
    {
      "sender": "member-1",
      "accountName": "Alice",
      "timestamp": 1711468800,
      "type": 0,
      "content": "Hello"
    }
  ]
}
```

## Fields

### Header

| Path                  | Required | Contract                        |
| --------------------- | -------- | ------------------------------- |
| `chatlab.version`     | yes      | Exactly `0.0.2`                 |
| `chatlab.exportedAt`  | yes      | Integer Unix seconds            |
| `chatlab.generator`   | no       | Converter name                  |
| `chatlab.description` | no       | Short non-sensitive description |
| `meta.name`           | yes      | Conversation display name       |
| `meta.platform`       | yes      | Stable platform slug            |
| `meta.type`           | yes      | `group` or `private`            |
| `meta.groupId`        | no       | Original group/conversation ID  |
| `meta.groupAvatar`    | no       | Data URL or network URL         |
| `meta.ownerId`        | no       | Exporting user's `platformId`   |

### Member

| Field           | Required | Contract                                               |
| --------------- | -------- | ------------------------------------------------------ |
| `platformId`    | yes      | Stable, unique string identity                         |
| `accountName`   | yes      | Account display name                                   |
| `groupNickname` | no       | Conversation-specific display name                     |
| `aliases`       | no       | String array                                           |
| `avatar`        | no       | Data URL or network URL                                |
| `roles`         | no       | Array such as `[{"id":"owner"}]` or `[{"id":"admin"}]` |

### Message

| Field               | Required | Contract                                                |
| ------------------- | -------- | ------------------------------------------------------- |
| `sender`            | yes      | Sender member `platformId`                              |
| `accountName`       | yes      | Account name at send time                               |
| `groupNickname`     | no       | Group nickname at send time                             |
| `timestamp`         | yes      | Integer Unix seconds                                    |
| `type`              | yes      | Numeric value from the table below                      |
| `content`           | yes      | String or `null`; preserve useful source representation |
| `platformMessageId` | no       | Unique original message ID                              |
| `replyToMessageId`  | no       | Target original message ID                              |

## Message types

| Value | Meaning           | Value | Meaning          |
| ----- | ----------------- | ----- | ---------------- |
| `0`   | text              | `1`   | image            |
| `2`   | voice             | `3`   | video            |
| `4`   | file              | `5`   | emoji/sticker    |
| `7`   | link/card         | `8`   | location         |
| `20`  | red packet        | `21`  | transfer         |
| `22`  | poke/nudge        | `23`  | call             |
| `24`  | share             | `25`  | reply            |
| `26`  | forwarded message | `27`  | contact card     |
| `80`  | system event      | `81`  | recalled message |
| `99`  | other/unknown     |       |                  |

For media without embedded content, retain a useful placeholder or source-relative reference in `content`; use `null` only when the source truly contains no representation.

## Identity fallback

Use the source's immutable user ID first. If absent, derive a deterministic ID from stable identity fields within the same platform and conversation, for example a SHA-256 digest of normalized account identity with a non-sensitive prefix. Do not use array position alone when member order can change, and never use randomness.

Preserve an original message ID when present. If it is absent, normally omit `platformMessageId`. Generate a deterministic message ID only when reply relationships require one; include conversation identity, sender identity, second timestamp, stable source ordinal, and a content digest so repeated runs produce the same result.

## Required reconciliation

The converter must report these numbers without message bodies:

- source conversations and source message records;
- output conversations, members, and messages;
- records mapped to type `99`;
- skipped and failed records.

Default skipped and failed records to zero. The conversion is not complete until source messages equal output messages plus user-accepted skipped records, strict validation passes, and `chatlab import <output> --dry-run --json` succeeds.
