/**
 * Agent 系统提示词构建
 */

import { t as i18nT } from '../../i18n'
import type { OwnerInfo } from '../tools/types'
import type { SkillContext } from './types'
import type { ToolContext } from '../tools/types'

function agentT(key: string, locale: string, options?: Record<string, unknown>): string {
  return i18nT(key, { lng: locale, ...options })
}

/**
 * 获取系统锁定部分的提示词（策略说明、时间处理等）
 *
 * 工具定义通过 Function Calling 的 tools 参数传递给 LLM，
 * 无需在 System Prompt 中重复描述。
 */
function getLockedPromptSection(
  chatType: 'group' | 'private',
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN',
  mentionedMembers?: ToolContext['mentionedMembers']
): string {
  const now = new Date()
  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const isPrivate = chatType === 'private'
  const chatContext = agentT(`ai.agent.chatContext.${chatType}`, locale)

  const ownerNote = ownerInfo
    ? agentT('ai.agent.ownerNote', locale, {
        displayName: ownerInfo.displayName,
        platformId: ownerInfo.platformId,
        chatContext,
      })
    : ''

  const memberNote = isPrivate
    ? agentT('ai.agent.memberNotePrivate', locale)
    : agentT('ai.agent.memberNoteGroup', locale)

  const mentionedMembersNote =
    mentionedMembers && mentionedMembers.length > 0
      ? `${agentT('ai.agent.mentionedMembersNote', locale)}\n${mentionedMembers
          .map((member) => {
            const aliasPart = member.aliases.length > 0 ? ` | aliases=${member.aliases.join(',')}` : ''
            return `- member_id=${member.memberId} | mention=${member.mentionText} | display_name=${member.displayName} | platform_id=${member.platformId}${aliasPart}`
          })
          .join('\n')}\n`
      : ''

  const year = now.getFullYear()
  const prevYear = year - 1

  return `${agentT('ai.agent.currentDateIs', locale)} ${currentDate}。
${ownerNote}
${mentionedMembersNote}
${memberNote}
${agentT('ai.agent.timeParamsIntro', locale)}
- ${agentT('ai.agent.timeParamExample1', locale, { year })}
- ${agentT('ai.agent.timeParamExample2', locale, { year })}
- ${agentT('ai.agent.timeParamExample3', locale, { year })}
${agentT('ai.agent.defaultYearNote', locale, { year, prevYear })}

${agentT('ai.agent.responseInstruction', locale)}`
}

function getFallbackRoleDefinition(chatType: 'group' | 'private', locale: string = 'zh-CN'): string {
  return agentT(`ai.agent.fallbackRoleDefinition.${chatType}`, locale)
}

/**
 * 构建完整的系统提示词
 *
 * 系统提示词优先使用当前助手配置；若助手不存在，再退回内置默认角色定义。
 *
 * 最终格式：{助手系统提示词}\n\n{系统锁定段(日期/owner/时间参数/通用指引)}
 */
export function buildSystemPrompt(
  chatType: 'group' | 'private' = 'group',
  assistantSystemPrompt?: string,
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN',
  skillCtx?: SkillContext,
  mentionedMembers?: ToolContext['mentionedMembers']
): string {
  const systemPrompt = assistantSystemPrompt || getFallbackRoleDefinition(chatType, locale)
  const lockedSection = getLockedPromptSection(chatType, ownerInfo, locale, mentionedMembers)

  let skillSection = ''
  if (skillCtx?.skillDef) {
    skillSection =
      `\n## ${agentT('ai.agent.currentTask', locale)}：${skillCtx.skillDef.name}\n` +
      `${agentT('ai.agent.skillPriorityNote', locale)}\n` +
      skillCtx.skillDef.prompt
  } else if (skillCtx?.skillMenu) {
    skillSection = `\n${skillCtx.skillMenu}`
  }

  return `${systemPrompt}${skillSection}

${lockedSection}`
}
