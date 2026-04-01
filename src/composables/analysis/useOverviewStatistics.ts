import { computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { HourlyActivity, DailyActivity, WeekdayActivity } from '@/types/analysis'
import dayjs from 'dayjs'

interface UseOverviewStatisticsProps {
  session: AnalysisSession
  messageTypes: Array<{ type: MessageType; count: number }>
  hourlyActivity: HourlyActivity[]
  dailyActivity: DailyActivity[]
  timeRange: { start: number; end: number } | null
  selectedYear: number | null
  filteredMessageCount: number
  filteredMemberCount: number
}

export function useOverviewStatistics(props: UseOverviewStatisticsProps, weekdayActivity: Ref<WeekdayActivity[]>) {
  const { t } = useI18n()

  // 时间跨度
  const durationDays = computed(() => {
    if (props.selectedYear) {
      const isLeapYear =
        (props.selectedYear % 4 === 0 && props.selectedYear % 100 !== 0) || props.selectedYear % 400 === 0
      return isLeapYear ? 366 : 365
    }
    if (!props.timeRange) return 0
    return Math.ceil((props.timeRange.end - props.timeRange.start) / 86400)
  })

  // 显示的消息数
  const displayMessageCount = computed(() => {
    return props.selectedYear ? props.filteredMessageCount : props.session.messageCount
  })

  // 显示的成员数
  const displayMemberCount = computed(() => {
    return props.selectedYear ? props.filteredMemberCount : props.session.memberCount
  })

  // 全量时间跨度 (不随筛选变化)
  const totalDurationDays = computed(() => {
    if (!props.timeRange) return 0
    return Math.ceil((props.timeRange.end - props.timeRange.start) / 86400)
  })

  // 全量日均消息
  const totalDailyAvgMessages = computed(() => {
    if (totalDurationDays.value === 0) return 0
    return Math.round(props.session.messageCount / totalDurationDays.value)
  })

  // 日均消息数 (随筛选变化)
  const dailyAvgMessages = computed(() => {
    if (durationDays.value === 0) return 0
    return Math.round(displayMessageCount.value / durationDays.value)
  })

  // 图片消息数量
  const imageCount = computed(() => {
    const imageType = props.messageTypes.find((t) => t.type === 1)
    return imageType?.count || 0
  })

  // 最活跃时段
  const peakHour = computed(() => {
    if (!props.hourlyActivity.length) return null
    return props.hourlyActivity.reduce(
      (max, h) => (h.messageCount > max.messageCount ? h : max),
      props.hourlyActivity[0]
    )
  })

  // 最活跃星期
  const peakWeekday = computed(() => {
    if (!weekdayActivity.value.length) return null
    return weekdayActivity.value.reduce(
      (max, w) => (w.messageCount > max.messageCount ? w : max),
      weekdayActivity.value[0]
    )
  })

  // 星期名称映射（周一开始）- 国际化
  const weekdayNames = computed(() => [
    t('common.weekday.mon'),
    t('common.weekday.tue'),
    t('common.weekday.wed'),
    t('common.weekday.thu'),
    t('common.weekday.fri'),
    t('common.weekday.sat'),
    t('common.weekday.sun'),
  ])

  // 周末活跃度
  const weekdayVsWeekend = computed(() => {
    if (!weekdayActivity.value.length) return { weekday: 0, weekend: 0 }
    const weekdaySum = weekdayActivity.value
      .filter((w) => w.weekday >= 1 && w.weekday <= 5)
      .reduce((sum, w) => sum + w.messageCount, 0)
    const weekendSum = weekdayActivity.value
      .filter((w) => w.weekday >= 6 && w.weekday <= 7)
      .reduce((sum, w) => sum + w.messageCount, 0)
    const total = weekdaySum + weekendSum
    return {
      weekday: total > 0 ? Math.round((weekdaySum / total) * 100) : 0,
      weekend: total > 0 ? Math.round((weekendSum / total) * 100) : 0,
    }
  })

  // 最活跃的一天
  const peakDay = computed(() => {
    if (!props.dailyActivity.length) return null
    return props.dailyActivity.reduce((max, d) => (d.messageCount > max.messageCount ? d : max), props.dailyActivity[0])
  })

  // 活跃天数
  const activeDays = computed(() => {
    return props.dailyActivity.filter((d) => d.messageCount > 0).length
  })

  // 总天数（用于计算活跃率）
  const totalDays = computed(() => {
    if (!props.timeRange) return 0
    const start = dayjs.unix(props.timeRange.start)
    const end = dayjs.unix(props.timeRange.end)
    return end.diff(start, 'day') + 1
  })

  // 活跃率
  const activeRate = computed(() => {
    return totalDays.value > 0 ? Math.round((activeDays.value / totalDays.value) * 100) : 0
  })

  // 最长连续打卡天数
  const maxConsecutiveDays = computed(() => {
    if (!props.dailyActivity.length) return 0

    // 按日期排序确保顺序正确
    const sortedDates = [...props.dailyActivity]
      .filter((d) => d.messageCount > 0)
      .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf())

    if (sortedDates.length === 0) return 0

    let maxStreak = 1
    let currentStreak = 1

    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = dayjs(sortedDates[i - 1].date)
      const currDate = dayjs(sortedDates[i].date)

      // 检查是否是连续的每一天
      if (currDate.diff(prevDate, 'day') === 1) {
        currentStreak++
      } else {
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak
        }
        currentStreak = 1
      }
    }

    // 循环结束后再次检查最后一段连续天数
    if (currentStreak > maxStreak) {
      maxStreak = currentStreak
    }

    return maxStreak
  })

  return {
    durationDays,
    displayMessageCount,
    displayMemberCount,
    dailyAvgMessages,
    totalDurationDays,
    totalDailyAvgMessages,
    imageCount,
    peakHour,
    peakWeekday,
    weekdayNames,
    weekdayVsWeekend,
    peakDay,
    activeDays,
    totalDays,
    activeRate,
    maxConsecutiveDays,
  }
}
