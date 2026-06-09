import type { DataSnapshot } from './prompt-builder'

export interface ChatOverviewForSnapshot {
  name: string
  platform: string
  type: string
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  topMembers?: Array<{ id: number; name: string; count: number }>
  summaryCount?: number
}

function roundShare(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10) / 10
}

function formatNullableTimestamp(timestamp: number | null | undefined): string {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? String(timestamp) : 'null'
}

function formatSharePercent(share: number): string {
  if (!Number.isFinite(share)) return '0%'
  const rounded = Math.round(share * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

export function createDataSnapshotFromOverview(
  overview: ChatOverviewForSnapshot | null | undefined
): DataSnapshot | undefined {
  if (!overview) return undefined

  const topMembers = overview.topMembers ?? []

  return {
    version: 2,
    name: overview.name,
    platform: overview.platform,
    type: overview.type,
    totalMessages: overview.totalMessages,
    totalMembers: overview.totalMembers,
    firstMessageTs: overview.firstMessageTs,
    lastMessageTs: overview.lastMessageTs,
    activeMemberHints: topMembers.slice(0, 10).map((member) => ({
      memberId: member.id,
      displayName: member.name,
      messageCount: member.count,
      share: overview.totalMessages > 0 ? roundShare((member.count / overview.totalMessages) * 100) : 0,
    })),
    segmentSummaries: {
      availableCount: overview.summaryCount ?? 0,
    },
  }
}

export function formatDataSnapshotForRouter(dataSnapshot: DataSnapshot | undefined): string {
  if (!dataSnapshot) return '(none)'

  return [
    `name: ${dataSnapshot.name}`,
    `platform: ${dataSnapshot.platform}`,
    `type: ${dataSnapshot.type}`,
    `total_messages: ${dataSnapshot.totalMessages}`,
    `total_members: ${dataSnapshot.totalMembers}`,
    `first_message_ts: ${formatNullableTimestamp(dataSnapshot.firstMessageTs)}`,
    `last_message_ts: ${formatNullableTimestamp(dataSnapshot.lastMessageTs)}`,
    `segment_summaries_available: ${dataSnapshot.segmentSummaries?.availableCount ?? 0}`,
    `active_member_hint_count: ${dataSnapshot.activeMemberHints?.length ?? 0}`,
  ].join('\n')
}

export function formatDataSnapshotForPlanner(dataSnapshot: DataSnapshot | undefined): string {
  if (!dataSnapshot) return '(none)'

  const memberHints = dataSnapshot.activeMemberHints ?? []
  const memberHintLines =
    memberHints.length > 0
      ? memberHints
          .map(
            (member, index) =>
              `${index + 1}. member_id=${member.memberId} | display_name=${member.displayName} | messages=${member.messageCount} | share=${formatSharePercent(member.share)}`
          )
          .join('\n')
      : '(none)'

  return `${formatDataSnapshotForRouter(dataSnapshot)}
active_member_hints:
${memberHintLines}
notes:
- member_id is a tool lookup hint; display_name may not be unique.
- Active member hints reflect historical total message volume, not recent activity.
- Use real current date for relative ranges; database bounds only describe data coverage.
- Do not plan a tool call only to rediscover min/max timestamp.`
}
