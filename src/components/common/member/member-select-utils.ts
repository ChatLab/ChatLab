import type { MemberWithStats } from '@/types/analysis'
import type { TableSortState } from '@/composables/useTable'

export type MemberSortField = 'groupNickname' | 'messageCount' | 'lastMessageTs'

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

export function shouldShowMemberMergeControls(chatType: 'group' | 'private', memberCount: number): boolean {
  return chatType === 'group' || memberCount > 2
}

function normalizeMemberSortValue(value: number | string | null): number | string | null {
  if (typeof value !== 'string') return value
  return value.trim() || null
}

function compareMemberSortValues(valueA: number | string, valueB: number | string): number {
  if (typeof valueA === 'number' && typeof valueB === 'number') return valueA - valueB
  return String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: 'base' })
}

export function filterAndSortMembers(
  members: MemberWithStats[],
  searchQuery: string,
  sortState: TableSortState<MemberSortField>
): MemberWithStats[] {
  const query = searchQuery.trim().toLocaleLowerCase()
  const filtered = query
    ? members.filter((member) =>
        [member.accountName, member.groupNickname, member.platformId, ...member.aliases].some((value) =>
          value?.toLocaleLowerCase().includes(query)
        )
      )
    : members

  if (sortState.field === null || sortState.direction === null) return [...filtered]

  const direction = sortState.direction === 'asc' ? 1 : -1
  const field = sortState.field

  return [...filtered].sort((memberA, memberB) => {
    const valueA = normalizeMemberSortValue(memberA[field])
    const valueB = normalizeMemberSortValue(memberB[field])

    if (valueA === null && valueB === null) return memberA.id - memberB.id
    if (valueA === null) return 1
    if (valueB === null) return -1

    const difference = compareMemberSortValues(valueA, valueB) * direction
    return difference || memberA.id - memberB.id
  })
}
