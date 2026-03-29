---
name: generate-assistant-config
description: Use when 用户希望根据一句自然语言需求创建新的 ChatLab assistant 配置、assistant Markdown、分析助手模板，或需要为群聊/私聊场景整理可写入 assistant/<locale>/<assistant-id>.md 的多语言助手文件。
---

# generate-assistant-config

为 ChatLab 生成 assistant Markdown。先动态追问补齐关键信息，只输出中文预览；用户确认后，再生成 `zh / en / ja` 三份本地化版本并写入 `assistant/`。

## 使用前先确认

- `skills/` 是开发代理技能目录；本技能自身放这里
- `assistant/` 是 assistant Markdown 产物目录；最终 assistant 文件写这里
- 当前仓库里的 `assistant/*.md` 可视为历史参考样例；新生成的多语言 assistant 写入 `assistant/<locale>/`
- 当前项目 assistant 的真实格式以运行时代码为准，不以过期文档为准
- 如 `.docs/ai/assistantSystem.md` 与运行时代码冲突，以以下文件为准：
  - `electron/main/ai/assistant/parser.ts`
  - `electron/main/ai/assistant/types.ts`
  - `electron/main/ai/assistant/manager.ts`
  - `electron/main/ai/tools/definitions/index.ts`
  - `electron/main/ai/tools/definitions/sql-analysis.ts`

## 必读上下文

开始前读取这些文件，只读满足任务所需的最小内容：

1. 项目与 AI 总体上下文
   - `.docs/README.md`
   - `.docs/ai/aiArchitecture.md`
   - `.docs/ai/assistantSystem.md`
2. assistant 真实格式与落地约束
   - `electron/main/ai/assistant/parser.ts`
   - `electron/main/ai/assistant/types.ts`
   - `electron/main/ai/assistant/manager.ts`
3. 默认骨架与工具来源
   - `electron/main/ai/assistant/builtins/general_cn.md`
   - `electron/main/ai/tools/definitions/index.ts`
   - `electron/main/ai/tools/definitions/sql-analysis.ts`

## 硬规则

- 不要直接套用旧文档中的 `version`、`order`、`customSqlTools` 等已过期字段
- frontmatter 只允许使用当前 parser 支持的字段：
  - `id`
  - `name`
  - `presetQuestions`
  - `allowedBuiltinTools`
  - `builtinId`
  - `applicableChatTypes`
  - `supportedLocales`
- 生成普通 assistant 文件时，不要写 `builtinId`
- 如果角色无需分析工具，优先省略 `allowedBuiltinTools`（默认仅核心工具可用）
- `allowedBuiltinTools` 仅填写分析工具名（核心工具始终可用，无需列出），不得臆造、不得引用旧名字
- 最终写入路径固定为 `assistant/<locale>/<assistant-id>.md`
- 目标语言固定为 `zh`、`en`、`ja`
- 三个语言版本保持同一角色定位，但允许按语言做自然的本地化调整，不做机械直译
- 任一目标文件已存在时，必须停止并征求用户确认，不能直接覆盖

## 动态追问规则

- 用户通常会给一句自然语言需求，例如“帮我生成一个适用于群聊的社群分析助手”
- 先从用户原话中提取已有信息，不要重复问已经明确的内容
- 只追问缺失且会影响 assistant 行为边界的关键信息
- 追问应当动态，不使用固定问卷
- 每轮只问一个当前最关键的问题，通常总问题数控制在 3 到 5 个
- 优先补齐以下信息：
  - 角色核心目标：主要解决什么问题
  - 使用场景：`group`、`private` 或通用
  - 语气与回答风格：专业、温暖、轻松、克制等
  - 输出偏好：更偏总结、排行、建议、证据引用、结构化呈现
  - 明显不该给的工具边界
- 如果用户一句话已经足够清楚，可以少问；不要为了凑问题数而发问

## 工作流

### 阶段一：中文预览，不落盘

1. 读完必读上下文后，先总结已知信息和仍然缺失的关键点
2. 动态追问，直到信息足够生成 assistant
3. 先生成一份中文 assistant Markdown 预览
4. 此阶段只在对话中输出 Markdown，不写文件
5. 预览完成后，明确等待用户确认，不要提前生成多语言文件

### 阶段二：确认后生成多语言文件

仅在用户明确确认中文预览后执行：

1. 为 `zh`、`en`、`ja` 各生成一份 assistant Markdown
2. 三份文件使用同一个 `assistant-id`
3. `name`、`presetQuestions`、正文语气允许按语言本地化
4. `supportedLocales` 分别写为：
   - `zh` 文件：`- zh`
   - `en` 文件：`- en`
   - `ja` 文件：`- ja`
5. 写入前检查以下目标是否已存在：
   - `assistant/zh/<assistant-id>.md`
   - `assistant/en/<assistant-id>.md`
   - `assistant/ja/<assistant-id>.md`
6. 任一已存在则停止，并把已存在路径明确告诉用户，等待是否覆盖的确认
7. 用户确认允许覆盖后，才写入全部目标文件

## assistant-id 规则

- 使用英文小写短横线命名
- 不带语言后缀
- 不带无意义的 `assistant` 冗余词，除非不带会造成歧义
- 尽量根据角色核心定位提炼为 2 到 4 个词

示例：

- 社群运营分析助手 -> `community-analyst`
- 客服复盘助手 -> `customer-service-reviewer`
- 关系洞察助手 -> `relationship-insight`

如果用户给了明确名称：

- 尊重用户命名语义
- 自动规范化为合法 id
- 如名称过泛，例如“分析助手”，先追问收窄再定 id

## 工具选择规则

工具分为两类：
- **核心工具（core）**：始终启用，无需在 `allowedBuiltinTools` 中列出。包括：get_chat_overview, search_messages, get_recent_messages, get_message_context, search_sessions, get_session_messages, get_members
- **分析工具（analysis）**：需在 `allowedBuiltinTools` 中显式列出才会启用

`allowedBuiltinTools` 仅用于控制分析工具，核心工具始终可用：
- 若角色不需要分析工具，可省略 `allowedBuiltinTools`（默认仅核心工具可用）
- 若角色需要特定分析能力，列出所需的分析工具名称
- 仅在角色明显聚焦时选择对应的分析工具，例如：
  - 强运营分析：get_member_stats, get_time_stats, member_activity_trend, silent_members
  - 强情感洞察：mutual_interaction_pairs, reply_interaction_ranking, get_conversation_between
  - 强客服分析：unanswered_messages, message_type_breakdown, get_conversation_between

生成前做一次自检：

- 是否引用了不存在的工具名
- `allowedBuiltinTools` 中是否误放了核心工具（核心工具无需列出）
- 是否包含明显与场景冲突的工具

## 输出模板

中文预览与最终落盘文件都使用同一结构：

```md
---
id: assistant-id
name: 助手名称
applicableChatTypes:
  - group
supportedLocales:
  - zh
allowedBuiltinTools:
  - get_member_stats
  - get_time_stats
presetQuestions:
  - 示例问题 1
  - 示例问题 2
---

你是一位……

你的核心能力是：

- …
- …

你的回答风格应该……

## 回答要求

1. …
2. …
3. …
```

## frontmatter 细则

- `id`：所有语言版本保持一致
- `name`：允许本地化，不必逐字对应
- `applicableChatTypes`：仅在能明确判断时写入；通用角色可省略
- `supportedLocales`：按文件所属语言写单元素数组
- `allowedBuiltinTools`：仅填写需要的分析工具名（核心工具无需列出，始终可用）
- `presetQuestions`：建议 3 到 5 条，贴近该语言用户的自然表达

## 正文写法规则

- 第一段：一句话定义角色与任务
- 第二段：列出“核心能力”
- 第三段：定义回答风格
- 最后使用 `## 回答要求`
- 回答要求应强调：
  - 基于工具结果，不编造
  - 数据不足时明确说明
  - 输出结构和证据引用方式
  - 该角色独有的风格约束

## 确认前后的响应要求

用户确认前：

- 只输出中文预览 Markdown
- 不写文件
- 不提前生成 `en` 或 `ja`
- 在 Markdown 后用一句话请求确认

用户确认后：

- 先检查目标路径是否存在
- 若不存在，再生成并写入三份文件
- 完成后向用户汇报：
  - 实际写入的 3 个路径
  - 是否做了工具白名单限制
  - 是否有任何本地化调整

## 常见错误

- 把 assistant 产物写到 `skill/` 或 `skills/`，而不是 `assistant/`
- 机械照抄 `.docs/ai/assistantSystem.md` 的旧字段
- 在未确认中文预览前就直接落盘
- 把核心工具名塞进 `allowedBuiltinTools`（核心工具始终可用，不需要列出）
- 多语言版本仅做逐字翻译，导致预设问题和语气不自然
- 发现同名文件已存在，却直接覆盖
