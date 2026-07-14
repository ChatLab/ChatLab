---
name: chatlab-analyze-cn
description: 通过 chatlab CLI 分析本地 ChatLab 聊天记录。当用户要求外部 Agent 检查对话、查找证据、总结话题、比较成员，或基于已导入的 ChatLab 数据分析指定人物或群组关系时使用。
---

# ChatLab 聊天分析

通过只读 `chatlab` CLI 查询和分析已经导入 ChatLab 的聊天记录。

## 适用场景

- 查找某段对话，或确认谁最先提到某件事。
- 总结近期话题，或分析与某个人的聊天关系。
- 比较成员活跃度、关键词或回复规律。

如果要导入新的聊天导出文件，请使用 `chatlab-import-cn`。

安装命令：

```bash
npx skills add ChatLab/ChatLab --skill chatlab-analyze-cn -g
```

## 工作流程

### 1. 准备查询

检查 CLI、读取当前命令契约并列出会话：

```bash
chatlab --help
chatlab manifest
chatlab sessions list --format json
```

只有一个相关会话时直接使用；多个会话或成员都可能匹配时，让用户从返回的候选项中选择。

### 2. 从专用命令开始

先使用能直接回答问题的最简单命令：

```bash
chatlab messages search "<keyword>" --session <session-id> --format agent
chatlab messages between --member me --member <member> --session <session-id> --last 90d --format agent
chatlab topics list --session <session-id> --last 30d --format agent
```

读取消息文本时使用 `--format agent`；侦察会话、成员、数量和 `--no-content` 搜索等结构时使用 `--format json`。

### 3. 补充上下文或统计

只有第一步结果不足时再深入：

```bash
chatlab messages context --id 1021 --session <session-id> --window 10 --format agent
chatlab stats keywords --session <session-id> --member <member> --last 90d --top 20 --format json
```

当 `meta.hasMore` 为 true 时，保持相同查询条件并使用 `--cursor <meta.nextCursor>` 继续。通过数量和 Token 参数只获取回答问题所需的上下文。

### 4. 最后才使用 SQL

只有专用命令无法回答时，才使用只读 SQL：

```bash
chatlab schema --session <session-id> --format json
chatlab sql "SELECT COUNT(*) AS n FROM message" --session <session-id> --format json
```

## 隐私与回答

- 绝不使用 `--raw`、修改 ChatLab 数据、导入文件、更改配置或启动长期运行的服务。
- 绝不泄露完整聊天记录。ChatLab 的安全输出会应用用户配置的隐私预处理。
- 使用 `[#1021]`、`[#1021*]` 或 `[#1021-1024]` 等可用标记引用消息证据。
- 先直接回答，说明实际查询的会话和时间范围，再区分观察到的事实与解释。
- 分析关系时不要过度推断情绪意图。仅在修正方式明确时遵循 `error.hint`。
- 优先使用用户当前使用的中文变体回答，命令、参数、JSON 字段和证据标记保持原样。
