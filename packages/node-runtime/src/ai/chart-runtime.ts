import { CHART_CAPABILITY_SKILL_ID } from '@openchatlab/core'
import { appendSkillMenuLines, formatSkillMenuLine } from './skill-menu'
import type { SkillDef } from './types'

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

export function resolveChartRuntimeForRequest(options: ResolveChartRuntimeOptions): ResolvedChartRuntime {
  const locale = options.locale ?? 'zh-CN'
  const isExplicitChartSkill = options.skillId === CHART_CAPABILITY_SKILL_ID
  const isAutoChartSkill =
    options.enableAutoDetection === true &&
    !options.skillId &&
    shouldUseChartCapabilityForMessage(options.userMessage ?? '')

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

你必须通过 render_chart 工具生成图表。不要输出 HTML、JavaScript、SVG、Canvas、ECharts option 或任何渲染代码。

硬性规则：
1. 第一次写 SQL 前必须先调用 get_schema。禁止猜测表名、字段名或时间字段。
2. “最近”“到现在”“到最近”必须用数据中的 MAX(ts) 或等价字段确定结束日期；不要手算或臆测日期。
3. ChatLab 的 message.ts 是秒级 Unix 时间戳，使用 date(ts, 'unixepoch', 'localtime')；禁止写 ts/1000。
4. “最近的 N 人/成员”必须先用数据定义并筛选出 N 个成员，再只统计这些成员。
5. 折线图有多条线时，每条线必须有明确 series 字段含义；按日期统计时应补齐日期 × series 的 0 值，避免缺失日期导致折线断裂或误连。
6. 工具失败、SQL 修正、schema 探索过程不要写进最终回答；最终只保留图表和简短结论。
7. 图表解释只能描述数据直接支持的趋势、峰值、低谷、差异和同步性，禁止夸张拟人化或无法从图中验证的关系判断。

工作流程：
1. 调用 get_schema。
2. 根据 schema 和用户要求确定统计对象、时间范围、维度、指标和图表类型。
3. 必要时用只读 SQL 在 render_chart 中完成成员筛选、时间范围确认、聚合和补零。
4. 调用 render_chart，提交只读 SQL 和 ChartSpec v1。
5. 图表生成后，用 1-3 句简洁文字解释结论。用户要求多张图时，可以多次调用 render_chart。

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

You must generate charts through the render_chart tool. Do not output HTML, JavaScript, SVG, Canvas, ECharts options, or rendering code.

Hard rules:
1. Always call get_schema before writing the first SQL query. Do not guess table names, field names, or timestamp fields.
2. For "latest", "until now", or "through the latest date", derive the end date from MAX(ts) or the equivalent timestamp field in the data. Do not hand-calculate or assume dates.
3. ChatLab message.ts is a Unix timestamp in seconds. Use date(ts, 'unixepoch', 'localtime'); never write ts/1000.
4. For "latest N members" or "recent N people", first define and select those N members from the data, then count only those members.
5. For multi-series line charts, every line must have an explicit series field. For daily counts, fill the date x series grid with zero values so missing days do not break or mislead the line.
6. Do not include failed SQL attempts, schema exploration, or retry reasoning in the final answer. Final answer should contain only the chart and a short conclusion.
7. Explain only trends, peaks, lows, differences, and synchrony directly supported by chart data. Do not make exaggerated personality or relationship claims.

Workflow:
1. Call get_schema.
2. Derive the target members, time range, dimensions, metrics, and chart type from schema and the user request.
3. When needed, use read-only SQL inside render_chart to select members, determine time range, aggregate data, and fill zero rows.
4. Call render_chart with read-only SQL and ChartSpec v1.
5. After the chart is generated, explain the key finding in 1-3 concise sentences. If the user asks for multiple charts, call render_chart multiple times.

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
