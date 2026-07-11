# 全局洞察：年度总结设计

## 1. 背景与目标

全局洞察是跨全部已导入会话分析“我”的顶层页面。现有私聊和群聊分析都以单个 session 为边界，而每个聊天数据库已经通过 `meta.owner_id` 标识当前用户；`ownerProfilesByPlatform` 负责把已确认身份应用到同平台的其他会话。因此，全局洞察可以在不猜测身份的前提下聚合多个会话中的 owner 数据。

第一阶段只实现 **A：年度总结**，回答以下问题：

- 我发出了多少消息，活跃了多少天？
- 我与多少人发生过直接互动？
- 我的消息量在一年中如何变化？
- 我的日常活跃节奏是什么？
- 我通常发送哪些类型、什么长度的消息？

页面只使用本地确定性统计，不依赖 LLM。

## 2. 已确认范围

### 2.1 第一阶段：年度总结

全局洞察采用父路由加顶层 Tab 的组织；年度总结能力在产品中显示为默认 Tab“关于我”，并在 Tab 内保持单页布局，不增加二级 Tab。页面本身使用 Bento 卡片网格：

1. 左侧主区域：身份化标题、年度 KPI 和月度消息趋势
2. 右侧区域：按月拆分的每日活跃日历
3. 底部区域：消息类型、文本长度和峰值摘要

### 2.2 后续方向

以下能力预留为顶层 Tab 和独立子路由，当前只展示占位状态，不预埋接口或快照字段：

- **B：时间投入**：按月份分析主要投入在哪些人、群聊和平台；如需“聊天时长”，必须先确定清晰的对话段估算规则并标注为估算。
- **C：关系变化**：关系升温或降温、新增或沉寂关系、好友数量变化、关系保质期、最长连续互动关系。

### 2.3 不在范围内

- AI 生成年度总结文案
- 估算聊天时长
- 关系保质期或关系变化算法
- “聊天段最多”或“一次聊得最久”等连续对话指标
- A 内部的二级 Tab
- 前端并发请求所有 session 后自行聚合
- 常驻的强制刷新按钮

## 3. 时间范围

复用 `src/components/common/TimeSelect.vue` 的视觉和交互，但全局洞察只开放两种模式：

- **按年**：默认当前自然年，可以切换存在可分析数据的历史年份。
- **最近一年**：最近 365 天，以当前时间为结束点。

全局页面默认显示当前自然年，即使当前年没有数据也不自动跳转。此时显示：

> 2026 年暂无可分析数据，最近有效数据为 2024 年。

提示提供一键切换到最近有效年份的操作。

`TimeSelect` 当前通过 `sessionId` 自行请求单会话年份和时间边界。实现时应做最小扩展：

- 支持由父页面传入全局 `availableYears` 和 `fullRange`，传入后不再请求单个 session。
- 支持限制可见的 mode 和 recent 选项；全局页面只传入 `year`、`recent` 和 `365`。
- 保持原有私聊、群聊页面的默认行为和 API 不变。

全局可选年份包含当前年以及所有存在 owner 发出消息的历史年份。`fullRange.end` 使用当前时间，而不是最新消息时间，确保“最近一年”不会因旧归档而错误地回退到历史数据末尾。

## 4. 指标口径

所有指标只统计聊天数据库中的非系统消息。涉及“我发出”的指标时，sender 必须是当前 session 中 `meta.owner_id` 解析出的 member。

### 4.1 首屏 KPI

| 指标 | 定义 |
| --- | --- |
| 发出消息数量 | 所选范围内 owner 发出的非系统消息总数 |
| 活跃天数 | 所选范围内 owner 至少发出一条消息的本地自然日数量 |
| 直接互动人数 | 所选范围内所有直接互动联系人按现有 contact key 规则跨会话去重后的数量 |
| 日均消息 | 发出消息数量 / 所选范围内已过去的自然日数量 |
| 日均互动人数 | 每日本地自然日的直接互动人数之和 / 所选范围内已过去的自然日数量 |

日均指标包含零消息日。当前自然年的分母为 1 月 1 日至今天（含今天），历史年份使用完整自然年，最近一年使用实际 365 天范围。

### 4.2 直接互动人数

直接互动采用严格口径：

- **私聊**：所选范围内存在有效非系统消息的私聊对象。
- **群聊**：所选范围内与 owner 存在明确 reply 关系的人；owner 可以是回复者或被回复者。
- **不计入**：仅与 owner 在同一群出现、但没有明确回复关系的群成员。

私聊联系人按发生消息的本地日期计入每日互动人数；群聊联系人按 reply 消息的本地日期计入。跨 session 去重必须复用联系人模块已有的平台级和 session-scoped contact key 规则，避免第三份身份拼接逻辑。

### 4.3 月度消息趋势

- 按本地月份聚合 owner 发出的消息。
- 自然年固定返回 12 个月，缺失月份补零。
- 最近一年按跨越的自然月份顺序返回，首尾月份可能不是完整月。

### 4.4 每日活跃热力图

- 按本地日期统计 owner 发出的消息。
- 自然年覆盖完整日历；当前年的未来日期不展示为数据。
- 最近一年覆盖实际选择范围。
- tooltip 只显示日期和消息数。

### 4.5 消息类型

- 复用现有消息类型分类语义。
- 只统计 owner 发出的消息。
- 返回每种类型的数量，前端计算占比并展示总数和百分比。

### 4.6 文本长度

- 只统计 owner 发出的文本消息。
- 长度沿用现有 core 查询的字符长度语义。
- 展示中位数、P90 和固定区间分布：`1-10`、`11-30`、`31-100`、`101-300`、`300+`。
- 空文本和非文本消息不进入长度统计。

## 5. 页面设计

### 5.1 数据画布

- 页面标题“洞察”、“关于我”/“时间投入”/“关系变化”顶层 Tab，以及“关于我”的时间选择器。
- 年度概览、活跃日历、消息类型、文本长度和峰值摘要分别是直接参与页面布局的同级 `ThemeCard elevated`，不再使用包裹全部内容的外层卡片。
- 主趋势卡使用 `decorative` 背景，整体沿用私聊/群聊总览首卡的视觉语言。
- 左侧主区域顶部展示 4 个主 KPI：发出消息、活跃天数、直接互动人数和日均消息，下方紧接月度消息趋势。
- 右侧使用按月拆分的小型日历网格展示每日活跃节奏，同时显示活跃天数和日期覆盖率。
- 底部并列展示消息类型、文本长度，以及日均互动人数、峰值月份和峰值日期。
- 覆盖率状态与时间范围进入画布身份信息区；身份提示提供进入完善流程的操作。
- 所有卡片均不使用描边，层级只通过背景、留白与阴影建立；卡片内部不再嵌套视觉卡片。

### 5.2 响应式组织

- 宽屏使用不对称双列：左侧主趋势约占三分之二，右侧日历约占三分之一；底部按 5/3/4 的比例组织三个摘要区域。
- 窄屏下各卡片依次纵向排列；消息类型使用紧凑网格，日历月份自动换列。
- 页面不使用叙事 Hero、营销式说明、独立饼图或重复热力图区块。

### 5.3 空状态

- 当前年份无数据时保持当前年份，不隐式跳转。
- 如果存在历史可分析数据，提示最近有效年份并提供一键切换。
- 如果没有任何 session 能解析 owner，解释需要先设置“我是谁”并提供操作入口。
- 如果 owner 已设置但所选范围没有消息，显示正常的零数据年度状态，不误报为身份缺失。

## 6. 架构

采用独立的全局洞察聚合服务，不扩展 contacts 或 relationships 的业务快照：

```text
Insight page
  -> shared HTTP route
  -> GlobalInsightService
  -> snapshot signature check
  -> temporary worker when missing/stale
  -> per-session facts cache
  -> cross-session aggregation
  -> atomic global snapshot
```

建议代码边界：

- `packages/core`：单个聊天数据库的 owner 年度事实查询与纯聚合 helper。
- `packages/node-runtime/src/services/global-insight/`：跨 session 编排、时间范围、签名、session facts cache、worker、snapshot 和 service。
- `packages/http-routes`：共享只读 route；Electron 和 CLI Web 使用同一 service。
- `src/services`：前端数据访问方法。
- `src/pages/insight/index.vue`：持有共享 Header、顶层 Tab 和子路由出口。
- `src/pages/insight/annual-summary/`：年度总结页面状态和展示组件。
- `src/pages/insight/time-investment/`、`src/pages/insight/relationship-changes/`：后续能力的预留子页，不包含业务逻辑。
- `packages/shared-types`：HTTP 响应、cache 和 task 状态类型。

route 和前端不得直接遍历数据库或复制聚合算法。

## 7. API 设计

第一阶段提供一个只读入口：

```text
GET /_web/global-insight/annual-summary?mode=year&year=2026&acceptStale=1
GET /_web/global-insight/annual-summary?mode=recent&days=365&acceptStale=1
```

非法 mode、year 和 days 在 route 层归一为受支持值。响应结构：

```ts
interface AnnualSummaryResponse {
  range: {
    mode: 'year' | 'recent'
    year?: number
    days?: 365
    startTs: number
    endTs: number
  }
  availableDataYears: number[]
  latestDataYear: number | null
  metrics: {
    sentMessageCount: number
    activeDayCount: number
    directContactCount: number
    averageMessagesPerDay: number
    averageDirectContactsPerDay: number
  } | null
  monthlyActivity: Array<{ month: string; messageCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: {
    textMessageCount: number
    median: number | null
    p90: number | null
    buckets: Array<{ key: string; count: number }>
  } | null
  coverage: {
    totalSessions: number
    analyzedSessions: number
    missingOwnerSessions: number
    unresolvedOwnerSessions: number
    failedSessions: number
  }
  cache: {
    status: 'missing' | 'fresh' | 'stale'
    computedAt: number | null
    signature?: string
    staleReason?: string
  }
  task: {
    id: string | null
    status: 'idle' | 'running' | 'succeeded' | 'failed' | 'superseded'
    startedAt: number | null
    finishedAt: number | null
    processedSessions: number
    totalSessions: number
    lastError?: string
  }
}
```

`metrics` 和图表字段在没有可用快照时返回空值/空数组，页面根据 `cache` 和 `task` 展示计算状态，不能把尚未计算解释为零数据。

## 8. 缓存设计

复用现有 contacts/relationships 的模式和 `packages/node-runtime/src/cache/session-cache.ts`，不新建通用缓存框架。

### 8.1 两级缓存

1. **session facts cache**
   - 每个 session 保存所选范围内的 owner 日级消息数、消息类型计数、文本长度频次和每日直接互动 contact keys。
   - 同时保存该 session 中 owner 消息出现过的年份，用于合并 `availableDataYears`。
   - entry 包含 DB/WAL fingerprint、事实格式版本、算法版本和标准化时间范围。
   - DB 未变化且范围一致时直接命中，避免重新扫描消息表。

2. **global snapshot**
   - 保存已聚合、可直接返回给页面的响应数据，不保存联系人名称或聊天内容。
   - 按 `year-<YYYY>` 和 `recent-365` 隔离；同一范围只保留最新快照。
   - 使用临时文件加 rename 原子落盘；损坏文件备份后视为 missing。

建议目录：

```text
<userDataDir>/insight/annual-summary/
  facts/<sessionId>.cache.json
  annual-summary-year-2026.json
  annual-summary-recent-365.json
```

### 8.2 签名与失效

global signature 包含：

- 年度总结算法版本
- 标准化时间范围
- 当前本地日期（当前年和最近一年需要随日期推进）
- 排序后的 session ID 列表
- 每个 session 的 DB + WAL fingerprint

因此以下变化会自动失效：

- session 新增或删除
- 导入、增量导入或数据库写入
- `owner_id` 设置、清除或修改
- 时间范围变化
- 本地日期跨日
- 算法版本升级

worker 完成后重新计算 signature。输入 signature 或 worker snapshot signature 与最新 signature 不一致时，将结果标为 `superseded`，不得落盘。

### 8.3 stale-while-revalidate

- **fresh**：立即返回快照。
- **stale**：`acceptStale=1` 时返回旧快照并后台重算；页面显示“正在更新”。
- **missing**：启动后台任务，返回 task 进度；页面等待完成后刷新。
- 同一 service 实例同一时间只运行一个年度总结任务，重复读取复用当前任务。
- worker 失败后不在普通读取中无限自动重试；页面提供显式重试操作。

## 9. 异常、覆盖率与日志

### 9.1 session 处理

单个 session 的以下状态都转换为诊断事实，不中断整个 worker：

- 非聊天数据库或缺少 meta
- 不支持的聊天类型
- 缺少 owner
- owner 无法解析到 member
- 私聊对象缺失或歧义
- 数据库读取失败

覆盖率的 `totalSessions` 只包含能够识别为聊天数据库且类型受支持的 session。`analyzedSessions` 是成功解析 owner 并完成所选范围事实查询的数量。

### 9.2 日志

使用 `appLogger` 记录：

- 任务启动和完成
- 标准化范围和 session 数量
- session facts cache 命中/未命中/写入数量
- 快照状态和计算耗时
- worker、快照读写和单 session 失败

日志不得包含聊天内容、联系人名称、platform ID、API Key 或 token。错误分支将原始 `Error` 作为 `data` 传入。

## 10. 测试策略

### 10.1 core 与聚合集成测试

使用多个临时 SQLite 聊天数据库验证：

- owner 消息跨 session 合并
- 非 owner 和系统消息排除
- 私聊联系人和群聊 reply 联系人识别
- contact key 跨 session 去重及 session-scoped 平台隔离
- 自然年、当前年、最近 365 天、闰年和本地日期边界
- 空月份补零、活跃天数和两个日均分母
- 消息类型合并
- 文本长度中位数、P90 和固定 buckets
- missing owner、unresolved owner、非聊天 DB 和单库失败的覆盖率

### 10.2 缓存和 service 测试

- session facts cache 的 DB/WAL、范围和算法版本校验
- snapshot 原子写入、损坏备份和读取
- session 列表、owner 或数据库变化导致 signature 失效
- fresh、stale、missing 三种响应
- stale 时保留旧结果并启动 worker
- 同范围重复读取不启动重复任务
- signature 改变时丢弃过期 worker 结果
- worker 失败后的旧快照回退和显式重试
- service 关闭时终止进行中的 worker

### 10.3 route 与前端验证

- route 参数归一和响应契约
- 默认当前年、最近一年切换和历史年份切换
- 当前年无数据时提示最近有效年份并一键跳转
- 首次计算、stale 更新、失败重试和身份覆盖率状态
- 修改后的 `TimeSelect` 不回归现有私聊和群聊时间选择行为

不为静态文案或固定 DOM 结构新增脆弱测试。

## 11. 实施约束

- 第一阶段只实现本设计中的 A，不为 B/C 增加 speculative 字段或抽象。
- 优先复用现有 core 查询语义、contact key、session cache、worker runner、signature 和 snapshot 模式。
- contacts、relationships 和 global insight 保持独立 service 与快照生命周期。
- 不修改数据库 schema，不需要数据目录兼容门禁升级。
- 不引入新依赖。
