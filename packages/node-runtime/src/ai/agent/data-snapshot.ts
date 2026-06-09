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
