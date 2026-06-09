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

export interface ActiveMemberHint {
  memberId: number
  displayName: string
  messageCount: number
  share: number
}

export interface DataSnapshot {
  version?: 2
  name: string
  platform: string
  type: string
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  capturedAt?: number
  activeMemberHints?: ActiveMemberHint[]
  segmentSummaries?: {
    availableCount: number
  }
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

function formatNullableTimestamp(timestamp: number | null | undefined): string {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? String(timestamp) : 'null'
}

function formatSharePercent(share: number): string {
  if (!Number.isFinite(share)) return '0%'
  const rounded = Math.round(share * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function formatDataSnapshotContext(t: TranslateFn, dataSnapshot: DataSnapshot, locale: string): string {
  const memberHints = dataSnapshot.activeMemberHints ?? []
  const memberHintTitle =
    memberHints.length === 0
      ? agentT(t, 'ai.agent.dataSnapshotMemberHintsUnavailable', locale)
      : dataSnapshot.totalMembers <= 10
        ? agentT(t, 'ai.agent.dataSnapshotMemberHintsAll', locale)
        : agentT(t, 'ai.agent.dataSnapshotMemberHintsTop', locale)

  // 中文注释：启动上下文会进入每轮系统提示词，字段顺序和标签必须稳定，便于模型缓存和后续 smoke 对比。
  const memberHintLines =
    memberHints.length > 0
      ? memberHints
          .map((member, index) => {
            return `${index + 1}. member_id=${member.memberId} | display_name=${normalizeInlineText(member.displayName)} | messages=${member.messageCount} | share=${formatSharePercent(member.share)}`
          })
          .join('\n')
      : agentT(t, 'ai.agent.dataSnapshotMemberHintsEmpty', locale)

  return agentT(t, 'ai.agent.dataSnapshotContext', locale, {
    name: dataSnapshot.name,
    platform: dataSnapshot.platform,
    type: dataSnapshot.type,
    totalMessages: dataSnapshot.totalMessages,
    totalMembers: dataSnapshot.totalMembers,
    firstMessageTs: formatNullableTimestamp(dataSnapshot.firstMessageTs),
    firstMessageTime: formatTimestamp(dataSnapshot.firstMessageTs, locale),
    lastMessageTs: formatNullableTimestamp(dataSnapshot.lastMessageTs),
    lastMessageTime: formatTimestamp(dataSnapshot.lastMessageTs, locale),
    segmentSummaryCount: dataSnapshot.segmentSummaries?.availableCount ?? 0,
    memberHintTitle,
    memberHintLines,
    usageRules: agentT(t, 'ai.agent.dataSnapshotUsageRules', locale),
  })
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
  const dataSnapshotNote = dataSnapshot ? `${formatDataSnapshotContext(t, dataSnapshot, locale)}\n` : ''

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
