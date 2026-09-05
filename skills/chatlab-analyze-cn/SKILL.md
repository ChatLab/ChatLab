---
name: chatlab-analyze-cn
description: 通过 clb CLI 分析本地 ChatLab 聊天记录。当用户要求外部 Agent 检查对话、查找证据、总结话题、比较成员，或基于已导入的 ChatLab 数据分析指定人物或群组关系时使用。
---

# ChatLab 聊天分析

通过只读 `clb` CLI 查询和分析已经导入 ChatLab 的聊天记录。

导入新文件时，可用则使用 `chatlab-import-cn`；否则参考 `clb import --help`，在写入前预览准确的导入计划。

## 工作流程

### 1. 准备查询

每个任务读取一次当前命令契约；只有目标尚未确定时才列出会话：

```bash
clb manifest
clb sessions list --format json
```

复用对话中已确定的会话、成员和时间范围。仅在候选项和上下文仍无法消除关键歧义时询问。CLI 不可用时说明缺少的能力；安装需要授权。

### 2. 从专用命令开始

先使用能直接回答问题的最简单命令：

```bash
clb messages search "<keyword>" --session <session-id> --format agent
clb messages between --member me --member <member> --session <session-id> --last 90d --format agent
clb topics list --session <session-id> --last 30d --format agent
```

读取消息文本时使用 `--format agent`；侦察会话、成员、数量和 `--no-content` 搜索等结构时使用 `--format json`。

### 3. 补充上下文或统计

只有第一步结果不足时再深入：

```bash
clb messages context --id 1021 --session <session-id> --window 10 --format agent
clb stats keywords --session <session-id> --member <member> --last 90d --top 20 --format json
```

仍需证据且 `meta.hasMore` 为 true 时，保持相同查询条件并使用 `--cursor <meta.nextCursor>` 继续。问题已回答即可停止；查询不完整时说明覆盖范围，不把单页当成全集。

### 4. 最后才使用 SQL

只有专用命令无法回答时，才使用只读 SQL：

```bash
clb schema --session <session-id> --format json
clb sql "SELECT COUNT(*) AS n FROM message" --session <session-id> --format json
```

## 隐私与回答

- 查询保持隐私预处理启用，不使用 `--raw` 或修改数据、配置。另有明确导入请求时按导入流程处理。
- 绝不泄露完整聊天记录。ChatLab 的安全输出会应用用户配置的隐私预处理。
- 用 `[#1021]`、`[#1021*]` 或 `[#1021-1024]` 引用证据；`messages context --id` 只接受单个 ID，合并范围只用于展示。
- 先直接回答，说明实际查询的会话和时间范围，再区分观察到的事实与解释。
- 分析关系时不要过度推断情绪意图。仅在修正方式明确时遵循 `error.hint`。
- 优先使用用户当前使用的中文变体回答，命令、参数、JSON 字段和证据标记保持原样。
