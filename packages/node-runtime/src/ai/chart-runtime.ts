import { CHART_CAPABILITY_SKILL_ID } from '@openchatlab/core'
import { appendSkillMenuLines, formatSkillMenuLine } from './skill-menu'
import type { SkillDef } from './types'
import type { PlannerCapabilitySummary } from './agent/planning-types'
import type { ChartAutoMode } from '@openchatlab/shared-types'

export { CHART_CAPABILITY_SKILL_ID }

export const CHART_CAPABILITY_CORE_TOOLS = ['get_schema'] as const
export const CHART_CAPABILITY_ANALYSIS_TOOLS = ['render_chart'] as const

const RAW_SQL_TOOL_NAMES = new Set(['execute_sql'])

export interface ResolveChartRuntimeOptions {
  skillId?: string | null
  userMessage?: string
  locale?: string
  assistantAllowedTools?: readonly string[] | null
  enableAutoDetection?: boolean
  enableAnalyticalAutoDetection?: boolean
  chartAutoMode?: ChartAutoMode
}

export interface ResolvedChartRuntime {
  isChartCapability: boolean
  skillDef?: SkillDef
  allowedBuiltinTools?: string[]
}

export function getChartCapabilityAllowedBuiltinTools(allowedTools?: readonly string[] | null): string[] {
  const baseTools = (allowedTools ?? []).filter((toolName) => !RAW_SQL_TOOL_NAMES.has(toolName))
  return Array.from(new Set([...baseTools, ...CHART_CAPABILITY_ANALYSIS_TOOLS]))
}

export function getAllowedBuiltinToolsForChartAutoSkill(allowedTools?: readonly string[] | null): string[] | undefined {
  if (!allowedTools) return undefined
  if (allowedTools.length === 0) return []
  return Array.from(new Set([...allowedTools, ...CHART_CAPABILITY_ANALYSIS_TOOLS]))
}

export function shouldUseChartCapabilityForMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false

  return /(?:画|绘制|生成|做|出|展示).{0,8}(?:图|图表)|(?:图表|可视化|饼图|柱状图|条形图|折线图|热力图|趋势图|占比图|分布图|chart|charts|plot|visuali[sz]e|visuali[sz]ation|pie chart|bar chart|line chart|heatmap)/i.test(
    normalized
  )
}

export function shouldOfferChartCapabilityForAnalyticalMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  if (shouldUseChartCapabilityForMessage(normalized)) return true

  return /(?:趋势|变化|走势|排名|排行|前\s*\d+|top\s*\d*|最多|最少|高频|分布|占比|比例|构成|份额|活跃度|热度|按.{0,8}统计|统计.{0,8}按|trend|ranking|rank|top\s*\d*|distribution|ratio|share|percentage|breakdown)/i.test(
    normalized
  )
}

export function getChartPlannerCapabilityForMessage(options: {
  userMessage: string
  locale?: string
  availableTools: readonly string[]
  chartAutoMode?: ChartAutoMode
}): PlannerCapabilitySummary | null {
  const availableToolSet = new Set(options.availableTools)
  if (!availableToolSet.has('get_schema') || !availableToolSet.has('render_chart')) {
    return null
  }
  const chartAutoMode = options.chartAutoMode ?? 'suggest'
  const shouldOffer =
    chartAutoMode === 'explicit'
      ? shouldUseChartCapabilityForMessage(options.userMessage)
      : shouldOfferChartCapabilityForAnalyticalMessage(options.userMessage)
  if (!shouldOffer) {
    return null
  }

  const isZh = (options.locale ?? 'zh-CN').startsWith('zh')
  return {
    id: 'chart_generation',
    label: isZh ? '图表生成' : 'Chart generation',
    tools: ['get_schema', 'render_chart'],
    guidance: isZh
      ? '用户明确要求图表，或趋势、排名、分布、占比等分析用图更清楚时，可以在计划中加入最多一张图表步骤；必须先用 get_schema 确认 schema，再用 render_chart 生成图表；不要输出绘图代码。'
      : 'When the user explicitly asks for charts, or when trends, rankings, distributions, or ratios are clearer visually, you may add at most one chart step to the plan; call get_schema before render_chart; do not output chart-rendering code.',
  }
}

export function resolveChartRuntimeForRequest(options: ResolveChartRuntimeOptions): ResolvedChartRuntime {
  const locale = options.locale ?? 'zh-CN'
  const isExplicitChartSkill = options.skillId === CHART_CAPABILITY_SKILL_ID
  const allowAnalyticalAutoDetection =
    options.chartAutoMode !== undefined
      ? options.chartAutoMode === 'aggressive'
      : options.enableAnalyticalAutoDetection === true
  const shouldAutoDetectChart =
    shouldUseChartCapabilityForMessage(options.userMessage ?? '') ||
    (allowAnalyticalAutoDetection && shouldOfferChartCapabilityForAnalyticalMessage(options.userMessage ?? ''))
  const isAutoChartSkill = options.enableAutoDetection === true && !options.skillId && shouldAutoDetectChart

  if (!isExplicitChartSkill && !isAutoChartSkill) {
    return { isChartCapability: false }
  }

  return {
    isChartCapability: true,
    skillDef: { ...getChartCapabilitySkill(locale), chatScope: 'all' },
    allowedBuiltinTools: getChartCapabilityAllowedBuiltinTools(options.assistantAllowedTools),
  }
}

export function getChartCapabilitySkill(locale: string = 'zh-CN'): SkillDef {
  const isZh = locale.startsWith('zh')
  return {
    id: CHART_CAPABILITY_SKILL_ID,
    name: isZh ? '绘图助手' : 'Chart Assistant',
    description: isZh ? '按本轮问题生成灵活的聊天数据图表' : 'Generate flexible charts for this chat question',
    tags: [isZh ? '图表' : 'chart'],
    chatScope: 'all',
    tools: ['render_chart', 'get_schema'],
    prompt: isZh ? ZH_PROMPT : EN_PROMPT,
    builtinId: CHART_CAPABILITY_SKILL_ID,
  }
}

function getChartMenuLine(locale: string): string {
  const skill = getChartCapabilitySkill(locale)
  const isZh = locale.startsWith('zh')
  const guidance = isZh
    ? '用户明确要求图表、画图、占比、趋势、分布、饼图、柱状图、折线图或热力图时优先激活；不要输出 Python/JS 绘图代码'
    : 'Activate first when the user explicitly asks for charts, visualization, ratios, trends, distributions, pie, bar, line, or heatmap charts; do not output Python/JS chart code'
  return formatSkillMenuLine({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    guidance,
  })
}

export function buildSkillMenuWithBuiltinChart(
  baseMenu: string | null | undefined,
  locale: string = 'zh-CN',
  allowedTools?: readonly string[] | null
): string | null {
  if (allowedTools && !allowedTools.includes(CHART_CAPABILITY_ANALYSIS_TOOLS[0])) return baseMenu ?? null
  if (baseMenu?.includes(CHART_CAPABILITY_SKILL_ID)) return baseMenu

  const chartLine = getChartMenuLine(locale)
  return appendSkillMenuLines(baseMenu, [chartLine]) ?? ''
}

export function getSkillConfigWithBuiltinChart(
  id: string,
  locale: string = 'zh-CN',
  getSkillConfig: (id: string) => SkillDef | null
): SkillDef | null {
  if (id === CHART_CAPABILITY_SKILL_ID) return getChartCapabilitySkill(locale)
  return getSkillConfig(id)
}

const ZH_PROMPT = `你是 ChatLab 绘图助手。本轮用户希望你在回答里自然嵌入一张或多张图表。

你必须通过 render_chart 工具生成图表。不要输出 HTML、JavaScript、SVG、Canvas、ECharts option、Markdown 图片链接（如 ![图表](chart1.png)）或任何渲染代码。

硬性规则：
1. 第一次写 SQL 前必须先调用 get_schema。禁止猜测表名、字段名或时间字段。
2. “最近”“过去 N 天/年”等相对时间以系统提示中的真实当前日期为基准；如果启动上下文显示数据库覆盖不足，只分析用户时间范围与数据库覆盖范围的交集并说明缺口。
3. ChatLab 的 message.ts 是秒级 Unix 时间戳，使用 date(ts, 'unixepoch', 'localtime')；禁止写 ts/1000。
4. “最近的 N 人/成员”必须先用数据定义并筛选出 N 个成员，再只统计这些成员。
5. 折线图有多条线时，每条线必须有明确 series 字段含义；按日期统计时应补齐日期 × series 的 0 值，避免缺失日期导致折线断裂或误连。
6. 工具失败、SQL 修正、schema 探索过程不要写进最终回答；最终只保留原生图表和简短结论，禁止用 chart1.png、chart2.png 等文件名引用图表。
7. 调用 render_chart 时，ChatLab 会立即在该位置插入原生图表；需要图表就直接调用工具，不要写 SQL 注释、Markdown 图片或“已生成图表/见上图”这类文本占位。
8. 用户要求多张图时，图表应分散出现在相关总结或解释附近；不要把所有图集中生成后再在最后用文字引用。
9. 为图表准备数据时，优先调用高层工具（如 get_time_stats、member_stats）而非自己写 SQL；只有高层工具无法覆盖所需筛选或聚合时才用 sql。render_chart 不要用于元数据探测、标量查询、单行日期字符串或纯说明性结果。
10. render_chart 的工具结果会包含数据预览（Data preview）；用它分析峰值、低谷和差异，不要为了读取数值重复生成等价图表。
11. 图表解释只能描述数据直接支持的趋势、峰值、低谷、差异和同步性，禁止夸张拟人化或无法从图中验证的关系判断。

工作流程：
1. 调用 get_schema。
2. 根据 schema、用户要求、系统当前日期和启动上下文确定统计对象、时间范围、维度、指标和图表类型。
3. 如需调查事实、建立话题地图、筛选成员或确认统计口径，先用可用的普通分析工具完成；不要为了调查而生成临时图表。
4. 准备图表数据——先问自己：哪个可用的高层工具能直接提供这张图所需的数据？get_time_stats 能给时间分布、member_stats 能给成员排名；能用就调用，将 data 数组作为 rows 传入 render_chart。只有在高层工具无法覆盖所需筛选或聚合时，才编写 SQL。
5. 在希望图表出现的位置调用 render_chart，提交数据（rows 或 sql）和 ChartSpec v1。
6. 图表生成后，用 1-3 句简洁文字解释结论。用户要求多张图时，可以多次调用 render_chart，并把每张图放在最相关的段落附近。

常用语、口头禅、高频短句类图表必须排除非真人文本：发送者为系统消息、媒体占位（如 [表情包]、[图片]、[语音]、[视频]、[文件]、[链接]、[红包]、[转账]）以及撤回/删除提示都不能进入统计。

ChartSpec v1 支持：
- bar: encoding.x + encoding.y
- line: encoding.x + encoding.y，可选 encoding.series 表示每条线的含义
- pie: encoding.label + encoding.value
- heatmap: encoding.x + encoding.y + encoding.value

ChartSpec 示例：
{
  "version": 1,
  "type": "line",
  "title": "最近 30 天成员发言趋势",
  "encoding": { "x": "day", "y": "msg_count", "series": "member_name" },
  "unit": "条"
}

用户明确要求图表时必须尝试生成。用户没有明确要求时，只有排名、趋势、分布、占比或二维密度明显更清楚时才主动生成，且默认最多一张。`

const EN_PROMPT = `You are the ChatLab Chart Assistant. In this turn, the user wants one or more charts embedded naturally in the answer.

You must generate charts through the render_chart tool. Do not output HTML, JavaScript, SVG, Canvas, ECharts options, Markdown image links such as ![Chart](chart1.png), or rendering code.

Hard rules:
1. Always call get_schema before writing the first SQL query. Do not guess table names, field names, or timestamp fields.
2. For relative ranges like "recent" or "past N days/years", use the real current date from the system prompt as the baseline. If startup context shows incomplete database coverage, analyze only the intersection between the requested range and database coverage, and state the gap.
3. ChatLab message.ts is a Unix timestamp in seconds. Use date(ts, 'unixepoch', 'localtime'); never write ts/1000.
4. For "latest N members" or "recent N people", first define and select those N members from the data, then count only those members.
5. For multi-series line charts, every line must have an explicit series field. For daily counts, fill the date x series grid with zero values so missing days do not break or mislead the line.
6. Do not include failed SQL attempts, schema exploration, or retry reasoning in the final answer. Final answer should contain only native charts and a short conclusion; never reference charts with filenames like chart1.png or chart2.png.
7. When you call render_chart, ChatLab immediately inserts the native chart at that position. If a chart is needed, call the tool directly; do not write SQL-comment placeholders, Markdown images, or text such as "generated chart" or "see chart above".
8. If the user asks for multiple charts, place each chart near the relevant summary or explanation. Do not generate all charts together and then reference them later with text.
9. When preparing chart data, prefer calling a high-level tool (such as get_time_stats, member_stats) over writing SQL; only use sql when no high-level tool can satisfy the required filters or aggregations. Do not use render_chart for metadata inspection, scalar queries, single-row date strings, or purely explanatory results.
10. render_chart tool results include a Data preview; use it to identify peaks, lows, and differences. Do not generate equivalent charts again just to read values.
11. Explain only trends, peaks, lows, differences, and synchrony directly supported by chart data. Do not make exaggerated personality or relationship claims.

Workflow:
1. Call get_schema.
2. Derive the target members, time range, dimensions, metrics, and chart type from schema, the user request, system current date, and startup context.
3. If you need to investigate facts, build a topic map, select members, or confirm statistical definitions, use available ordinary analysis tools first; do not generate temporary charts for investigation.
4. Prepare chart data — ask yourself first: which available high-level tool can directly provide the data this chart needs? get_time_stats covers time distributions; member_stats covers member rankings. If one fits, call it and pass its data array as rows to render_chart. Only write SQL when no high-level tool can cover the required filters or aggregations.
5. Call render_chart at the position where the chart should appear, with data (rows or sql) and ChartSpec v1.
6. After the chart is generated, explain the key finding in 1-3 concise sentences. If the user asks for multiple charts, call render_chart multiple times and place each chart near its most relevant section.

For catchphrase, common phrase, or frequent short-text charts, exclude non-human text from the SQL: system-message senders, media placeholders such as [Sticker], [Image], [Photo], [Voice], [Video], [File], [Link], and recall/deletion notices must not be counted.

ChartSpec v1 supports:
- bar: encoding.x + encoding.y
- line: encoding.x + encoding.y, optional encoding.series for the meaning of each line
- pie: encoding.label + encoding.value
- heatmap: encoding.x + encoding.y + encoding.value

ChartSpec example:
{
  "version": 1,
  "type": "line",
  "title": "Member message trend in the last 30 days",
  "encoding": { "x": "day", "y": "msg_count", "series": "member_name" },
  "unit": "messages"
}

When the user explicitly asks for charts, you must try to generate them. If the user does not explicitly ask, add at most one chart only when ranking, trend, distribution, ratio, or two-dimensional density is clearly easier to understand visually.`
