---
outline: deep
---

# 外部 Agent 调用

ChatLab 可以作为 Codex、Claude Code、HermesAgent 等外部 Agent 的本地聊天数据工具层。外部 Agent 负责对话、规划和总结，ChatLab 负责受控地读取、搜索、统计和整理本地聊天记录。

这种模式不需要打开 ChatLab 网页，也不需要先启动 ChatLab 桌面界面。外部 Agent 会按需调用轻量的 `chatlab` CLI，在本地完成受控查询、搜索和统计，并拿到已经过隐私预处理的文本。

## 适合什么场景

- 你已经在使用 Codex、Claude Code、HermesAgent 等外部 Agent，并希望复用它们的订阅、token、模型能力和工作流。
- 你希望外部 Agent 能按需分析 ChatLab 里的聊天记录，但不想把原始数据库或完整聊天导出直接交给 Agent。
- 你希望先由 ChatLab 完成脱敏、黑名单过滤、清洗、合并和截断，再把适合分析的文本与可追溯的单条消息 id 提供给 Agent。

`chatlab` CLI 提供一组面向 AI Agent 优化、同时人类可读的查询命令。所有查询命令只读，默认应用你在 ChatLab 中配置的隐私预处理（脱敏、黑名单）。

安装：`npm i chatlab-cli -g`（需要 Node.js ≥ 20），并先在 ChatLab 中导入聊天记录。

## 命令总览

```bash
chatlab sessions list                # 列出已导入的会话
chatlab sessions show                # 查看单个会话详情
chatlab members list                 # 会话成员列表
chatlab members history              # 成员改名历史
chatlab messages list                # 按时间窗口列消息
chatlab messages search <关键词...>   # 关键词搜索（支持多词、上下文、翻页）
chatlab messages context --id <id>   # 查看某条消息前后现场
chatlab messages between             # 两个成员之间的对话
chatlab stats overview               # 会话概览统计
chatlab stats activity               # 成员活跃度排行
chatlab stats time --by day          # 时间分布（hour/weekday/day/month）
chatlab stats keywords               # 高频词（已过隐私过滤）
chatlab stats response               # 回复速度排行
chatlab topics list                  # AI 分段摘要列表
chatlab topics show --id <id>        # 某个分段的原始消息
chatlab sql "<SELECT ...>"           # 只读 SQL 兜底（字符串默认脱敏）
chatlab schema                       # 查看数据库表结构
chatlab manifest                     # 机读命令清单（给 Agent 一次读全）
```

只有一个会话时可省略 `--session`；多个会话时命令会返回候选列表提示消歧。

## 输出格式

通过 `--format` 显式指定：

- **`agent`**：推荐给 AI Agent 的格式。返回 JSON 信封，正文是经过完整预处理管道（清洗、黑名单、去噪、合并连续发言、脱敏、token 截断）的紧凑文本；单条消息标记 `[#id]` / `[#id*]` 可用于 `messages context --id`，合并块范围 `[#a-b]` 仅用于展示。
- **`json`**：程序化解析格式。返回结构化消息数组，仍应用隐私步骤（清洗、黑名单、脱敏），但不合并、不去噪。适合 `--no-content`、`--fields` 之类的结构化勘察。
- **`text`**：人类可读输出（终端默认）。

agent/json 模式下 stdout 只包含一个 JSON 响应信封，日志一律走 stderr：

```json
{
  "ok": true,
  "command": "messages.search",
  "data": { "text": "returned: 2\n\n--- 2026/6/1 ---\n[#1*] 09:00 老王: 今年五一去旅游吧..." },
  "meta": { "totalHits": 2, "returnedHits": 2, "hasMore": false, "preprocess": { "desensitized": true }, "apiVersion": 1 }
}
```

失败时返回 `{ "ok": false, "error": { "code", "message", "hint", "candidates" } }`，并配合语义化退出码：0 成功、2 参数错误/能力未开启、3 未找到、4 歧义（附候选列表）、5 SQL 错误。

## 常用查询参数

- **时间**：`--since` / `--until` 支持 `2026-06-01`、`"2026-06-01 08:30"`、ISO 8601、`today`、`yesterday`；`--last 30d` 支持 h/d/w。日期形式的 `--until` 包含整天，解析后的绝对边界回显在 `meta.timeRange`。
- **成员**：`--member` 接受成员 id、精确名称或 `me`（数据所有者）；重名时返回候选 id。
- **翻页**：`meta.hasMore` 为 true 时，用 `--cursor <meta.nextCursor>` 取下一页；cursor 与查询条件绑定。
- **Token 控制**：`--limit`（主对象数）、`--max-messages`（上下文展开上限）、`--max-tokens`（agent 正文预算，默认 4000）、`--max-chars`（单条内容截断）。

## 隐私边界

- 所有查询命令默认应用你在 ChatLab 设置中的脱敏规则与黑名单，包括 `stats keywords` 的词表、`topics list` 的摘要和 `sql` 结果中的字符串字段；`sql` 读取消息 `content` 列需要显式 `--raw`。
- `--raw`（绕过预处理）默认禁用，仅当你显式执行 `chatlab config set cli.allow_raw true` 或设置 `CHATLAB_CLI_ALLOW_RAW=1` 后可用。
- 不需要 SQL 兜底能力时，可用 `chatlab config set cli.allow_sql false` 关闭 `sql` 命令。

## 给 Agent 的使用指南

推荐通过通用 Agent Skills CLI 安装官方中文 `chatlab-analyze-cn` 技能：

```bash
npx skills add ChatLab/ChatLab --skill chatlab-analyze-cn -g
```

安装后，可以在 Codex、Claude Code、Cursor 等外部 Agent 中直接说：

```text
chatlab-analyze-cn 帮我分析我和小红的聊天记录
```

这个技能会引导 Agent 先执行 `chatlab manifest` 获取机读命令清单，再用安全的 `--format agent/json` 查询聊天记录。

`chatlab-analyze-cn` 始终只读。如果你希望 Agent 导入新的聊天导出文件，请改用独立的 `chatlab-import-cn` Skill；它会先预览导入计划，再自动新建或增量导入，详见[导入聊天记录指南](./how-to-import.md)。

典型配方——"谁最早提到某个问题？查看现场"：

```bash
chatlab messages search "服务器迁移" --sort asc --limit 5 --context 3 --format agent
# 从返回文本的单条消息标记 [#1021*] 拿到消息 id，再深挖现场：
chatlab messages context --id 1021 --window 10 --format agent
```
