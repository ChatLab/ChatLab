import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { DailyActivity } from '@/types/analysis'
import type { EChartLineData } from '@/components/charts'
import dayjs from 'dayjs'

export function useDailyTrend(dailyActivitySource: MaybeRefOrGetter<DailyActivity[]>) {
  // 统一兼容普通数组、ref 和 getter，避免在 setup 阶段拿到初始快照后丢失响应性。
  const resolvedDailyActivity = computed(() => toValue(dailyActivitySource))

  // 检测是否跨年
  const isMultiYear = computed(() => {
    const dailyActivity = resolvedDailyActivity.value
    if (dailyActivity.length < 2) return false
    const years = new Set(dailyActivity.map((d) => dayjs(d.date).year()))
    return years.size > 1
  })

  // 每日趋势图数据（动态聚合）
  const dailyChartData = computed<EChartLineData>(() => {
    const rawData = resolvedDailyActivity.value
    const maxPoints = 50 // 最大展示点数

    if (rawData.length <= maxPoints) {
      const dateFormat = isMultiYear.value ? 'YYYY/MM/DD' : 'MM/DD'
      return {
        labels: rawData.map((d) => dayjs(d.date).format(dateFormat)),
        values: rawData.map((d) => d.messageCount),
      }
    }

    // 需要聚合
    const groupSize = Math.ceil(rawData.length / maxPoints)
    const aggregatedLabels: string[] = []
    const aggregatedValues: number[] = []

    for (let i = 0; i < rawData.length; i += groupSize) {
      const chunk = rawData.slice(i, i + groupSize)
      if (chunk.length === 0) continue

      const midIndex = Math.floor(chunk.length / 2)
      const midDate = chunk[midIndex].date
      const dateFormat = isMultiYear.value ? 'YYYY/MM/DD' : 'MM/DD'
      aggregatedLabels.push(dayjs(midDate).format(dateFormat))

      const totalMessages = chunk.reduce((sum, d) => sum + d.messageCount, 0)
      const avgMessages = Math.round(totalMessages / chunk.length)
      aggregatedValues.push(avgMessages)
    }

    return {
      labels: aggregatedLabels,
      values: aggregatedValues,
    }
  })

  return {
    isMultiYear,
    dailyChartData,
  }
}
