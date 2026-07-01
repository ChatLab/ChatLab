import type { MemberWithStats } from '@/types/analysis'

export interface MemberSelectOption {
  id: number
  label: string
  secondary: string
  messageCount: number
  avatar: string | null
  member: MemberWithStats
}

export function getMemberDisplayName(member: MemberWithStats): string {
  return member.groupNickname || member.accountName || member.platformId
}

export function formatMemberOption(member: MemberWithStats): MemberSelectOption {
  const label = getMemberDisplayName(member)
  const aliasText = member.aliases.filter((alias) => alias && alias !== label).join('、')
  const secondaryParts = [aliasText, member.accountName, member.platformId].filter((part): part is string =>
    Boolean(part && part !== label)
  )

  return {
    id: member.id,
    label,
    secondary: secondaryParts.join(' · '),
    messageCount: member.messageCount,
    avatar: member.avatar,
    member,
  }
}

export function mergeMemberPages(current: MemberWithStats[], incoming: MemberWithStats[]): MemberWithStats[] {
  const merged = new Map<number, MemberWithStats>()
  for (const member of current) {
    merged.set(member.id, member)
  }
  for (const member of incoming) {
    merged.set(member.id, member)
  }
  return [...merged.values()]
}
