import { CHART_CAPABILITY_SKILL_ID, getChartCapabilitySkill } from '@openchatlab/core'
import type { SkillDef } from './types'

type SkillGetter = (id: string) => SkillDef | null

export function getBuiltinChartSkill(locale: string = 'zh-CN'): SkillDef {
  return { ...getChartCapabilitySkill(locale), builtinId: CHART_CAPABILITY_SKILL_ID }
}

function getChartMenuLine(locale: string): string {
  const skill = getBuiltinChartSkill(locale)
  const isZh = locale.startsWith('zh')
  const guidance = isZh
    ? '用户明确要求图表、画图、占比、趋势、分布、饼图、柱状图、折线图或热力图时优先激活；不要输出 Python/JS 绘图代码'
    : 'Activate first when the user explicitly asks for charts, visualization, ratios, trends, distributions, pie, bar, line, or heatmap charts; do not output Python/JS chart code'
  return `- ${skill.id}: ${skill.name} — ${skill.description}. ${guidance}`
}

export function buildSkillMenuWithBuiltinChart(baseMenu: string | null | undefined, locale: string = 'zh-CN'): string {
  if (baseMenu?.includes(CHART_CAPABILITY_SKILL_ID)) return baseMenu

  const chartLine = getChartMenuLine(locale)
  if (!baseMenu) {
    return `## 可用技能
以下是你可以使用的分析技能。当你判断用户的问题适合使用某个技能时，
请调用 activate_skill 工具激活它，然后按照返回的指导完成任务。

${chartLine}

如果用户的问题不需要使用技能，直接回答即可。`
  }

  const closing = '\n\n如果用户的问题不需要使用技能，直接回答即可。'
  if (!baseMenu.includes(closing)) return `${baseMenu}\n${chartLine}`

  return baseMenu.replace(closing, `\n${chartLine}${closing}`)
}

export function getSkillConfigWithBuiltinChart(
  id: string,
  locale: string = 'zh-CN',
  getSkillConfig: SkillGetter
): SkillDef | null {
  if (id === CHART_CAPABILITY_SKILL_ID) return getBuiltinChartSkill(locale)
  return getSkillConfig(id)
}
