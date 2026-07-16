import type { MemberWithStats } from '@/types/analysis'

export type MemberSortOrder = 'desc' | 'asc' | null

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

export function nextMemberSortOrder(current: MemberSortOrder): MemberSortOrder {
  if (current === 'asc') return 'desc'
  if (current === 'desc') return null
  return 'asc'
}

export function filterAndSortMembers(
  members: MemberWithStats[],
  searchQuery: string,
  sortOrder: MemberSortOrder
): MemberWithStats[] {
  const query = searchQuery.trim().toLocaleLowerCase()
  const filtered = query
    ? members.filter((member) =>
        [member.accountName, member.groupNickname, member.platformId, ...member.aliases].some((value) =>
          value?.toLocaleLowerCase().includes(query)
        )
      )
    : members

  if (sortOrder === null) return [...filtered]

  const direction = sortOrder === 'asc' ? 1 : -1

  return [...filtered].sort((memberA, memberB) => {
    const countDifference = (memberA.messageCount - memberB.messageCount) * direction
    return countDifference || memberA.id - memberB.id
  })
}
