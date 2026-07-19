# ChatLab 转换协议

生成 ChatLab Format `0.0.2` 时遵循本协议。这里只保留转换器需要的内容；生成文件以严格验证器的结果为准：

```bash
chatlab validate "/absolute/path/to/output.jsonl" --json
```

## 核心约束

- 一个输出文件只表示一个会话。
- 使用 UTF-8。时间统一使用整数型 Unix **秒级**时间戳，绝不能使用毫秒。
- `meta.type` 只能是 `group` 或 `private`。平台使用稳定的小写标识，例如 `qq`、`weixin` 或源产品名称。
- `sender` 和 `ownerId` 引用成员的 `platformId`。
- 保留每一条源记录。无法识别的消息映射为类型 `99`，不能丢弃。
- 有原始成员 ID、消息 ID 时原样保留；即使源数据是数字，输出 ID 也使用字符串。
- `platformMessageId` 可省略，但出现时必须唯一；`replyToMessageId` 引用其中一个消息 ID。
- 消息按 `timestamp` 升序排列；时间相同时保留稳定的源序号。
- `accountName` 表示账号名称，`groupNickname` 表示该会话中的昵称。

## 推荐的 JSONL 结构

每行写一个紧凑 JSON 对象。第一个非注释数据行是唯一的 `header`，随后写全部 `member`，最后写 `message`。

```jsonl
{"_type":"header","chatlab":{"version":"0.0.2","exportedAt":1711468800,"generator":"local-converter"},"meta":{"name":"示例群聊","platform":"example","type":"group","groupId":"group-1","ownerId":"member-1"}}
{"_type":"member","platformId":"member-1","accountName":"小红","groupNickname":"小红","aliases":["红红"],"roles":[{"id":"owner"}]}
{"_type":"member","platformId":"member-2","accountName":"小明"}
{"_type":"message","platformMessageId":"message-1","sender":"member-1","accountName":"小红","groupNickname":"小红","timestamp":1711468800,"type":0,"content":"你好"}
{"_type":"message","platformMessageId":"message-2","replyToMessageId":"message-1","sender":"member-2","accountName":"小明","timestamp":1711468810,"type":25,"content":"收到"}
```

允许空行和以 `#` 开头的注释行，但转换器通常不应生成它们。只有源数据完全没有成员信息时才省略成员行；只要写了成员行，就必须在第一条消息前写完所有发送者。

## JSON 结构

只有完整结果可以安全地放入内存时才使用 JSON。`members` 和 `messages` 都是必需数组。

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1711468800,
    "generator": "local-converter"
  },
  "meta": {
    "name": "示例私聊",
    "platform": "example",
    "type": "private",
    "ownerId": "member-1"
  },
  "members": [
    { "platformId": "member-1", "accountName": "小红" },
    { "platformId": "member-2", "accountName": "小明" }
  ],
  "messages": [
    {
      "sender": "member-1",
      "accountName": "小红",
      "timestamp": 1711468800,
      "type": 0,
      "content": "你好"
    }
  ]
}
```

## 字段

### 文件头

| 路径                  | 必需 | 约束                   |
| --------------------- | ---- | ---------------------- |
| `chatlab.version`     | 是   | 固定为 `0.0.2`         |
| `chatlab.exportedAt`  | 是   | 整数型 Unix 秒级时间戳 |
| `chatlab.generator`   | 否   | 转换器名称             |
| `chatlab.description` | 否   | 不含隐私的简短说明     |
| `meta.name`           | 是   | 会话显示名称           |
| `meta.platform`       | 是   | 稳定的平台标识         |
| `meta.type`           | 是   | `group` 或 `private`   |
| `meta.groupId`        | 否   | 原始群组/会话 ID       |
| `meta.groupAvatar`    | 否   | Data URL 或网络 URL    |
| `meta.ownerId`        | 否   | 导出者的 `platformId`  |

### 成员

| 字段            | 必需 | 约束                                             |
| --------------- | ---- | ------------------------------------------------ |
| `platformId`    | 是   | 稳定且唯一的字符串身份                           |
| `accountName`   | 是   | 账号显示名称                                     |
| `groupNickname` | 否   | 当前会话中的显示名称                             |
| `aliases`       | 否   | 字符串数组                                       |
| `avatar`        | 否   | Data URL 或网络 URL                              |
| `roles`         | 否   | 如 `[{"id":"owner"}]`、`[{"id":"admin"}]` 的数组 |

### 消息

| 字段                | 必需 | 约束                                  |
| ------------------- | ---- | ------------------------------------- |
| `sender`            | 是   | 发送者的 `platformId`                 |
| `accountName`       | 是   | 发送时的账号名称                      |
| `groupNickname`     | 否   | 发送时的群昵称                        |
| `timestamp`         | 是   | 整数型 Unix 秒级时间戳                |
| `type`              | 是   | 使用下表中的数字                      |
| `content`           | 是   | 字符串或 `null`；尽量保留有用的源表示 |
| `platformMessageId` | 否   | 唯一的原始消息 ID                     |
| `replyToMessageId`  | 否   | 被回复消息的原始 ID                   |

## 消息类型

| 值   | 含义          | 值   | 含义      |
| ---- | ------------- | ---- | --------- |
| `0`  | 文本          | `1`  | 图片      |
| `2`  | 语音          | `3`  | 视频      |
| `4`  | 文件          | `5`  | 表情/贴纸 |
| `7`  | 链接/卡片     | `8`  | 位置      |
| `20` | 红包          | `21` | 转账      |
| `22` | 拍一拍/戳一戳 | `23` | 通话      |
| `24` | 分享          | `25` | 回复      |
| `26` | 转发消息      | `27` | 名片      |
| `80` | 系统事件      | `81` | 撤回消息  |
| `99` | 其他/未知     |      |           |

媒体消息没有内嵌正文时，在 `content` 中保留有用的占位符或源文件相对路径；只有源数据确实没有任何表示时才使用 `null`。

## 身份兜底规则

优先使用源平台不可变的用户 ID。确实缺少时，根据同一平台、同一会话内的稳定身份字段确定性生成，例如对规范化账号身份计算 SHA-256，并添加不敏感的前缀。成员顺序可能变化时不能只使用数组下标，绝不能使用随机值。

有原始消息 ID 时保留；没有时通常省略 `platformMessageId`。只有回复关系必须依赖消息 ID 时才生成确定性 ID，并纳入会话身份、发送者、秒级时间戳、稳定源序号和正文摘要，确保重复执行结果一致。

## 必须核对的数量

转换器必须在不输出正文的前提下报告：

- 源会话数和源消息记录数；
- 输出会话数、成员数和消息数；
- 映射为类型 `99` 的记录数；
- 跳过数和失败数。

跳过数和失败数默认为零。只有源消息数等于输出消息数加用户明确接受的跳过数、严格验证通过，并且 `chatlab import <output> --dry-run --json` 成功，转换才算完成。
