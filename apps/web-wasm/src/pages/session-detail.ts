import type { HourlyActivity, MemberActivity } from '@/types/analysis'
import type { MessageTypeStats } from '@openchatlab/core'
import type { EChartBarData, EChartPieData, RankItem } from '@/components/charts'

export function buildHourlyChartData(hourlyActivity: readonly HourlyActivity[]): EChartBarData {
  const hourMap = new Map(hourlyActivity.map((item) => [item.hour, item.messageCount]))

  return {
    labels: Array.from({ length: 24 }, (_, hour) => String(hour)),
    values: Array.from({ length: 24 }, (_, hour) => hourMap.get(hour) ?? 0),
  }
}

export function buildMemberRankItems(memberActivity: readonly MemberActivity[]): RankItem[] {
  return memberActivity.map((member) => ({
    id: String(member.memberId),
    name: member.name,
    value: member.messageCount,
    percentage: member.percentage,
  }))
}

export function buildMessageTypeChartData(
  messageTypes: readonly MessageTypeStats[],
  getLabel: (type: number) => string
): EChartPieData {
  const sorted = [...messageTypes].sort((left, right) => right.count - left.count)
  return {
    labels: sorted.map((item) => getLabel(item.type)),
    values: sorted.map((item) => item.count),
  }
}
