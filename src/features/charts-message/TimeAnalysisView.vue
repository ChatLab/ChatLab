<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EChartBar, EChartHeatmap, EChartCalendar, EChart } from '@/components/charts'
import type { EChartBarData, EChartHeatmapData, EChartCalendarData } from '@/components/charts'
import { SectionCard, LoadingState } from '@/components/UI'
import {
  queryHourlyActivity,
  queryDailyActivity,
  queryWeekdayActivity,
  queryMonthlyActivity,
  queryYearlyActivity,
  queryMessageTypes,
  queryMemberMonthlyTrend,
} from './queries'
import type {
  HourlyActivity,
  WeekdayActivity,
  MonthlyActivity,
  DailyActivity,
  YearlyActivity,
  MessageTypeCount,
} from './types'
import TimeProfileCard from './TimeProfileCard.vue'
import type { TimeFilter } from '@openchatlab/shared-types'
import type { EChartsOption } from 'echarts'

const props = defineProps<{
  sessionId: string
  sessionName?: string
  timeFilter?: TimeFilter
}>()

const { t } = useI18n()

const isLoading = ref(true)
const messageTypes = ref<MessageTypeCount[]>([])
const hourlyActivity = ref<HourlyActivity[]>([])
const weekdayActivity = ref<WeekdayActivity[]>([])
const monthlyActivity = ref<MonthlyActivity[]>([])
const yearlyActivity = ref<YearlyActivity[]>([])
const dailyActivity = ref<DailyActivity[]>([])
const memberTrend = ref<Array<{ month: string; memberId: number; memberName: string; count: number }>>([])

const memberColors = [
  '#6366f1',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#06b6d4',
  '#8b5cf6',
  '#f43f5e',
  '#eab308',
  '#14b8a6',
  '#3b82f6',
]

const weekdayNames = computed(() => [
  t('common.weekday.mon'),
  t('common.weekday.tue'),
  t('common.weekday.wed'),
  t('common.weekday.thu'),
  t('common.weekday.fri'),
  t('common.weekday.sat'),
  t('common.weekday.sun'),
])

const monthNames = computed(() => [
  t('common.month.jan'),
  t('common.month.feb'),
  t('common.month.mar'),
  t('common.month.apr'),
  t('common.month.may'),
  t('common.month.jun'),
  t('common.month.jul'),
  t('common.month.aug'),
  t('common.month.sep'),
  t('common.month.oct'),
  t('common.month.nov'),
  t('common.month.dec'),
])

// 小时分布
const hourlyChartData = computed<EChartBarData>(() => {
  const hourMap = new Map(hourlyActivity.value.map((h) => [h.hour, h.messageCount]))
  const labels: string[] = []
  const values: number[] = []
  for (let i = 0; i < 24; i++) {
    labels.push(`${i}`)
    values.push(hourMap.get(i) || 0)
  }
  return { labels, values }
})

// 星期分布
const weekdayChartData = computed<EChartBarData>(() => {
  const dayMap = new Map(weekdayActivity.value.map((w) => [w.weekday, w.messageCount]))
  const values: number[] = []
  for (let i = 1; i <= 7; i++) {
    values.push(dayMap.get(i) || 0)
  }
  return { labels: weekdayNames.value, values }
})

// 月份分布
const monthlyChartData = computed<EChartBarData>(() => {
  const monthMap = new Map(monthlyActivity.value.map((m) => [m.month, m.messageCount]))
  const values: number[] = []
  for (let i = 1; i <= 12; i++) {
    values.push(monthMap.get(i) || 0)
  }
  return { labels: monthNames.value, values }
})

// 年份分布
const yearlyChartData = computed<EChartBarData>(() => {
  const sorted = [...yearlyActivity.value].sort((a, b) => a.year - b.year)
  return {
    labels: sorted.map((y) => String(y.year)),
    values: sorted.map((y) => y.messageCount),
  }
})

// 热力图
const heatmapChartData = computed<EChartHeatmapData>(() => {
  const xLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`)
  const yLabels = weekdayNames.value
  const total = messageTypes.value.reduce((sum, item) => sum + item.count, 0) || 1
  const data: Array<[number, number, number]> = []

  for (let day = 1; day <= 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const dayCount = weekdayActivity.value.find((w) => w.weekday === day)?.messageCount || 0
      const hourCount = hourlyActivity.value.find((h) => h.hour === hour)?.messageCount || 0
      const value = Math.round((dayCount * hourCount) / total)
      data.push([hour, day - 1, value])
    }
  }

  return { xLabels, yLabels, data }
})

// 日历
const calendarChartData = computed<EChartCalendarData[]>(() =>
  dailyActivity.value.map((d) => ({ date: d.date, value: d.messageCount }))
)

const calendarYears = computed(() => {
  const years = new Set<number>()
  dailyActivity.value.forEach((d) => {
    const year = parseInt(d.date.split('-')[0])
    if (!isNaN(year)) years.add(year)
  })
  return Array.from(years).sort((a, b) => b - a)
})

const selectedCalendarYear = ref<number>(new Date().getFullYear())

const filteredCalendarData = computed(() => {
  const year = selectedCalendarYear.value
  return calendarChartData.value.filter((d) => d.date.startsWith(`${year}-`))
})

// 消息趋势（按成员堆叠面积图）
const memberTrendOption = computed<EChartsOption>(() => {
  if (memberTrend.value.length === 0) return {}

  const months = [...new Set(memberTrend.value.map((d) => d.month))].sort()

  // 按总发言量排序
  const memberTotals = new Map<number, { name: string; total: number }>()
  memberTrend.value.forEach((d) => {
    const existing = memberTotals.get(d.memberId)
    if (existing) {
      existing.total += d.count
    } else {
      memberTotals.set(d.memberId, { name: d.memberName, total: d.count })
    }
  })

  const isPrivateChat = memberTotals.size <= 2

  // 私聊：单条总趋势线
  if (isPrivateChat) {
    const monthlyTotalMap = new Map<string, number>()
    memberTrend.value.forEach((d) => {
      monthlyTotalMap.set(d.month, (monthlyTotalMap.get(d.month) || 0) + d.count)
    })
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderColor: 'transparent',
        textStyle: { color: '#fff' },
      },
      grid: { left: 50, right: 20, top: 10, bottom: 30 },
      xAxis: {
        type: 'category',
        data: months,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.2 },
          itemStyle: { color: '#6366f1' },
          data: months.map((m) => monthlyTotalMap.get(m) || 0),
        },
      ],
    }
  }

  // 群聊：取前10按成员堆叠
  const topMembers = [...memberTotals.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10)

  const series = topMembers.map(([memberId, info], i) => {
    const dataMap = new Map(memberTrend.value.filter((d) => d.memberId === memberId).map((d) => [d.month, d.count]))
    return {
      name: info.name,
      type: 'line' as const,
      stack: 'total',
      areaStyle: { opacity: 0.3 },
      smooth: true,
      symbol: 'none',
      itemStyle: { color: memberColors[i % memberColors.length] },
      data: months.map((m) => dataMap.get(m) || 0),
    }
  })

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: { color: '#fff' },
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: {
      type: 'category',
      data: months,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series,
  }
})

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    const [types, hourly, weekday, monthly, yearly, daily, trend] = await Promise.all([
      queryMessageTypes(props.sessionId, props.timeFilter),
      queryHourlyActivity(props.sessionId, props.timeFilter),
      queryWeekdayActivity(props.sessionId, props.timeFilter),
      queryMonthlyActivity(props.sessionId, props.timeFilter),
      queryYearlyActivity(props.sessionId, props.timeFilter),
      queryDailyActivity(props.sessionId, props.timeFilter),
      queryMemberMonthlyTrend(props.sessionId, props.timeFilter),
    ])

    messageTypes.value = types
    hourlyActivity.value = hourly
    weekdayActivity.value = weekday
    monthlyActivity.value = monthly
    yearlyActivity.value = yearly
    dailyActivity.value = daily
    memberTrend.value = trend

    if (calendarYears.value.length > 0) {
      selectedCalendarYear.value = calendarYears.value[0]
    }
  } catch (error) {
    console.error('[chart-message] Failed to load time analysis data:', error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div :class="isLoading ? 'h-full' : ''">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />

    <div v-else class="main-content mx-auto max-w-[920px] space-y-6 p-6">
      <!-- 时间画像卡 -->
      <TimeProfileCard
        v-if="dailyActivity.length > 0"
        :hourly-activity="hourlyActivity"
        :weekday-activity="weekdayActivity"
        :daily-activity="dailyActivity"
      />

      <!-- 小时 & 星期分布 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard :title="t('views.message.hourlyDistribution')" :show-divider="false">
          <div class="p-5">
            <EChartBar :data="hourlyChartData" :height="200" />
          </div>
        </SectionCard>

        <SectionCard :title="t('views.message.weekdayDistribution')" :show-divider="false">
          <div class="p-5">
            <EChartBar :data="weekdayChartData" :height="200" />
          </div>
        </SectionCard>
      </div>

      <!-- 月份 & 年份分布 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard :title="t('views.message.monthlyDistribution')" :show-divider="false">
          <div class="p-5">
            <EChartBar :data="monthlyChartData" :height="200" />
          </div>
        </SectionCard>

        <SectionCard :title="t('views.message.yearlyDistribution')" :show-divider="false">
          <div class="p-5">
            <EChartBar v-if="yearlyChartData.values.length > 0" :data="yearlyChartData" :height="200" />
            <div v-else class="flex h-48 items-center justify-center text-gray-400">
              {{ t('views.message.noData') }}
            </div>
          </div>
        </SectionCard>
      </div>

      <!-- 消息趋势 -->
      <SectionCard :title="t('views.message.timeAnalysis.memberTrendTitle')" :show-divider="false">
        <template #headerRight>
          <span class="text-xs text-gray-400">{{ t('views.message.timeAnalysis.memberTrendHint') }}</span>
        </template>
        <div class="p-5">
          <EChart v-if="memberTrend.length > 0" :option="memberTrendOption" :height="280" />
          <div v-else class="flex h-48 items-center justify-center text-gray-400">
            {{ t('views.message.noData') }}
          </div>
        </div>
      </SectionCard>

      <!-- 时间热力图 -->
      <SectionCard :title="t('views.message.timeHeatmap')" :show-divider="false">
        <template #headerRight>
          <span class="text-xs text-gray-400">{{ t('views.message.heatmapHint') }}</span>
        </template>
        <div class="p-5">
          <EChartHeatmap :data="heatmapChartData" :height="320" />
        </div>
      </SectionCard>

      <!-- 日历热力图 -->
      <SectionCard :title="t('views.message.calendarHeatmap')" :show-divider="false">
        <template #headerRight>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-400">{{ t('views.message.calendarHint') }}</span>
            <USelect
              v-if="calendarYears.length > 1"
              v-model="selectedCalendarYear"
              :items="calendarYears.map((y) => ({ value: y, label: String(y) }))"
              size="xs"
              class="w-20"
            />
          </div>
        </template>
        <div class="p-5">
          <EChartCalendar
            v-if="filteredCalendarData.length > 0"
            :data="filteredCalendarData"
            :year="selectedCalendarYear"
            :height="180"
          />
          <div v-else class="flex h-32 items-center justify-center text-gray-400">
            {{ t('views.message.noData') }}
          </div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>
