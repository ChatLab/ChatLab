/**
 * Agent system prompt builder — shared implementation.
 *
 * The i18n translation function is injected via `t` parameter,
 * making this module platform-agnostic.
 */

export interface OwnerInfo {
  platformId: string
  displayName: string
}

export interface MentionedMember {
  memberId: number
  platformId: string
  displayName: string
  aliases: string[]
  mentionText: string
}

export interface SkillContext {
  skillDef?: { name: string; prompt: string }
  skillMenu?: string
}

export interface DataSnapshot {
  name: string
  platform: string
  type: string
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  capturedAt: number
}

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string

export interface BuildSystemPromptOptions {
  t: TranslateFn
  chatType?: 'group' | 'private'
  assistantSystemPrompt?: string
  ownerInfo?: OwnerInfo
  locale?: string
  skillCtx?: SkillContext
  mentionedMembers?: MentionedMember[]
  dataSnapshot?: DataSnapshot
}

function agentT(t: TranslateFn, key: string, locale: string, options?: Record<string, unknown>): string {
  return t(key, { lng: locale, ...options })
}

function getLockedPromptSection(
  t: TranslateFn,
  chatType: 'group' | 'private',
  ownerInfo: OwnerInfo | undefined,
  locale: string,
  mentionedMembers: MentionedMember[] | undefined,
  dataSnapshot: DataSnapshot | undefined
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
  const chatContext = agentT(t, `ai.agent.chatContext.${chatType}`, locale)

  const ownerNote = ownerInfo
    ? agentT(t, 'ai.agent.ownerNote', locale, {
        displayName: ownerInfo.displayName,
        platformId: ownerInfo.platformId,
        chatContext,
      })
    : ''

  const memberNote = isPrivate
    ? agentT(t, 'ai.agent.memberNotePrivate', locale)
    : agentT(t, 'ai.agent.memberNoteGroup', locale)

  const mentionedMembersNote =
    mentionedMembers && mentionedMembers.length > 0
      ? `${agentT(t, 'ai.agent.mentionedMembersNote', locale)}\n${mentionedMembers
          .map((member) => {
            const aliasPart = member.aliases.length > 0 ? ` | aliases=${member.aliases.join(',')}` : ''
            return `- member_id=${member.memberId} | mention=${member.mentionText} | display_name=${member.displayName} | platform_id=${member.platformId}${aliasPart}`
          })
          .join('\n')}\n`
      : ''

  const year = now.getFullYear()
  const dataSnapshotNote = dataSnapshot
    ? `${agentT(t, 'ai.agent.dataSnapshotNote', locale, {
        name: dataSnapshot.name,
        platform: dataSnapshot.platform,
        totalMessages: dataSnapshot.totalMessages,
        totalMembers: dataSnapshot.totalMembers,
        firstMessageDate: formatTimestamp(dataSnapshot.firstMessageTs, locale),
        lastMessageDate: formatTimestamp(dataSnapshot.lastMessageTs, locale),
      })}\n`
    : ''

  return `${agentT(t, 'ai.agent.currentDateIs', locale)} ${currentDate}。
${ownerNote}
${mentionedMembersNote}
${dataSnapshotNote}
${memberNote}
${agentT(t, 'ai.agent.timeParamsIntro', locale)}
${agentT(t, 'ai.agent.defaultYearNote', locale, { year })}
${agentT(t, 'ai.agent.evidencePolicy', locale)}

${agentT(t, 'ai.agent.responseInstruction', locale)}`
}

function getFallbackRoleDefinition(t: TranslateFn, chatType: 'group' | 'private', locale: string): string {
  return agentT(t, `ai.agent.fallbackRoleDefinition.${chatType}`, locale)
}

function formatTimestamp(timestamp: number | null | undefined, locale: string): string {
  if (!timestamp) return locale.startsWith('zh') ? '未知' : 'unknown'

  const date = new Date(timestamp * 1000)
  if (Number.isNaN(date.getTime())) return locale.startsWith('zh') ? '未知' : 'unknown'

  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : locale
  return date.toLocaleString(dateLocale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    t,
    chatType = 'group',
    assistantSystemPrompt,
    ownerInfo,
    locale = 'zh-CN',
    skillCtx,
    mentionedMembers,
    dataSnapshot,
  } = options

  const systemPrompt = assistantSystemPrompt || getFallbackRoleDefinition(t, chatType, locale)
  const lockedSection = getLockedPromptSection(t, chatType, ownerInfo, locale, mentionedMembers, dataSnapshot)

  let skillSection = ''
  if (skillCtx?.skillDef) {
    skillSection =
      `\n## ${agentT(t, 'ai.agent.currentTask', locale)}：${skillCtx.skillDef.name}\n` +
      `${agentT(t, 'ai.agent.skillPriorityNote', locale)}\n` +
      skillCtx.skillDef.prompt
  } else if (skillCtx?.skillMenu) {
    skillSection = `\n${skillCtx.skillMenu}`
  }

  return `${systemPrompt}${skillSection}

${lockedSection}`
}
