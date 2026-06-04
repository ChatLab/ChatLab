export const MAX_SKILL_MENU_ITEMS = 15

const SKILL_MENU_HEADER = `## 可用技能
以下是你可以使用的分析技能。当你判断用户的问题适合使用某个技能时，
请调用 activate_skill 工具激活它，然后按照返回的指导完成任务。`

const SKILL_MENU_CLOSING = '如果用户的问题不需要使用技能，直接回答即可。'
const SKILL_MENU_CLOSING_BLOCK = `\n\n${SKILL_MENU_CLOSING}`

export interface SkillMenuItem {
  id: string
  name: string
  description: string
  guidance?: string
}

export function formatSkillMenuLine(item: SkillMenuItem): string {
  const guidanceSuffix = item.guidance ? `. ${item.guidance}` : ''
  return `- ${item.id}: ${item.name} — ${item.description}${guidanceSuffix}`
}

export function buildSkillMenuText(lines: readonly string[]): string | null {
  const visibleLines = normalizeSkillMenuLines(lines)
  if (visibleLines.length === 0) return null

  return `${SKILL_MENU_HEADER}

${visibleLines.join('\n')}

${SKILL_MENU_CLOSING}`
}

export function appendSkillMenuLines(baseMenu: string | null | undefined, lines: readonly string[]): string | null {
  const visibleLines = normalizeSkillMenuLines(lines)
  if (visibleLines.length === 0) return baseMenu ?? null
  if (!baseMenu) return buildSkillMenuText(visibleLines)

  const insertion = `\n${visibleLines.join('\n')}`
  if (!baseMenu.includes(SKILL_MENU_CLOSING_BLOCK)) {
    return `${baseMenu}${insertion}`
  }

  return baseMenu.replace(SKILL_MENU_CLOSING_BLOCK, `${insertion}${SKILL_MENU_CLOSING_BLOCK}`)
}

function normalizeSkillMenuLines(lines: readonly string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean)
}
