<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EChartPie, EChartBar, EChartHeatmap, EChartCalendar } from '@/components/charts'
import type { EChartPieData, EChartBarData, EChartHeatmapData, EChartCalendarData } from '@/components/charts'
import { SectionCard } from '@/components/UI'
import {
  queryMessageTypes,
  queryHourlyActivity,
  queryDailyActivity,
  queryWeekdayActivity,
  queryMonthlyActivity,
  queryYearlyActivity,
  queryLengthDistribution,
} from './queries'
import { getMessageTypeName } from './types'
import type {
  HourlyActivity,
  WeekdayActivity,
  MonthlyActivity,
  DailyActivity,
  YearlyActivity,
  MessageTypeCount,
} from './types'

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const { t } = useI18n()

// 数据状态
const isLoading = ref(true)
const messageTypes = ref<MessageTypeCount[]>([])
const hourlyActivity = ref<HourlyActivity[]>([])
const weekdayActivity = ref<WeekdayActivity[]>([])
const monthlyActivity = ref<MonthlyActivity[]>([])
const yearlyActivity = ref<YearlyActivity[]>([])
const dailyActivity = ref<DailyActivity[]>([])
const lengthDetail = ref<Array<{ len: number; count: number }>>([])
const lengthGrouped = ref<Array<{ range: string; count: number }>>([])

// 星期名称（按 1=周一 到 7=周日 的顺序）
const weekdayNames = computed(() => [
  t('common.weekday.mon'),
  t('common.weekday.tue'),
  t('common.weekday.wed'),
  t('common.weekday.thu'),
  t('common.weekday.fri'),
  t('common.weekday.sat'),
  t('common.weekday.sun'),
])

// 月份名称
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

// 消息类型饼图数据
const typeChartData = computed<EChartPieData>(() => {
  const sorted = [...messageTypes.value].sort((a, b) => b.count - a.count)
  return {
    labels: sorted.map((item) => getMessageTypeName(item.type, t)),
    values: sorted.map((item) => item.count),
  }
})

// 消息类型摘要数据（用于右侧列表展示）
const typeSummary = computed(() => {
  const total = messageTypes.value.reduce((sum, item) => sum + item.count, 0)
  const sorted = [...messageTypes.value].sort((a, b) => b.count - a.count)

  return sorted.map((item) => ({
    name: getMessageTypeName(item.type, t),
    count: item.count,
    percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
  }))
})

// 类型颜色
const typeColors = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
]

function getTypeColor(index: number): string {
  return typeColors[index % typeColors.length]
}

// 小时分布图表数据
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

// 星期分布图表数据
const weekdayChartData = computed<EChartBarData>(() => {
  const dayMap = new Map(weekdayActivity.value.map((w) => [w.weekday, w.messageCount]))
  const values: number[] = []

  for (let i = 1; i <= 7; i++) {
    values.push(dayMap.get(i) || 0)
  }

  return { labels: weekdayNames.value, values }
})

// 月份分布图表数据
const monthlyChartData = computed<EChartBarData>(() => {
  const monthMap = new Map(monthlyActivity.value.map((m) => [m.month, m.messageCount]))
  const values: number[] = []

  for (let i = 1; i <= 12; i++) {
    values.push(monthMap.get(i) || 0)
  }

  return { labels: monthNames.value, values }
})

// 年份分布图表数据
const yearlyChartData = computed<EChartBarData>(() => {
  const sorted = [...yearlyActivity.value].sort((a, b) => a.year - b.year)
  return {
    labels: sorted.map((y) => String(y.year)),
    values: sorted.map((y) => y.messageCount),
  }
})

// 消息长度详细分布图表数据
const lengthDetailChartData = computed<EChartBarData>(() => ({
  labels: lengthDetail.value.map((d) => String(d.len)),
  values: lengthDetail.value.map((d) => d.count),
}))

// 消息长度分组分布图表数据
const lengthGroupedChartData = computed<EChartBarData>(() => ({
  labels: lengthGrouped.value.map((d) => d.range),
  values: lengthGrouped.value.map((d) => d.count),
}))

// 热力图数据（小时 x 星期）
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

// 日历热力图数据
const calendarChartData = computed<EChartCalendarData[]>(() =>
  dailyActivity.value.map((d) => ({ date: d.date, value: d.messageCount }))
)

// 日历可用年份
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

// 加载数据 — 所有查询通过 window.chatApi.pluginQuery 在 Worker 线程执行
async function loadData() {
  if (!props.sessionId) return

  isLoading.value = true
  try {
    const [types, hourly, weekday, monthly, yearly, daily, lengthData] = await Promise.all([
      queryMessageTypes(props.sessionId, props.timeFilter),
      queryHourlyActivity(props.sessionId, props.timeFilter),
      queryWeekdayActivity(props.sessionId, props.timeFilter),
      queryMonthlyActivity(props.sessionId, props.timeFilter),
      queryYearlyActivity(props.sessionId, props.timeFilter),
      queryDailyActivity(props.sessionId, props.timeFilter),
      queryLengthDistribution(props.sessionId, props.timeFilter),
    ])

    messageTypes.value = types
    hourlyActivity.value = hourly
    weekdayActivity.value = weekday
    monthlyActivity.value = monthly
    yearlyActivity.value = yearly
    dailyActivity.value = daily
    lengthDetail.value = lengthData.detail
    lengthGrouped.value = lengthData.grouped

    if (calendarYears.value.length > 0) {
      selectedCalendarYear.value = calendarYears.value[0]
    }
  } catch (error) {
    console.error('[chart-message] Failed to load data:', error)
  } finally {
    isLoading.value = false
  }
}

// 监听 props 变化重新加载
watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <div class="main-content space-y-6 p-6">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex h-64 items-center justify-center">
      <UIcon name="i-heroicons-arrow-path" class="h-8 w-8 animate-spin text-gray-400" />
    </div>

    <template v-else>
      <!-- 消息类型分布 -->
      <SectionCard :title="t('views.message.typeDistribution')" :show-divider="false">
        <div class="p-5">
          <div v-if="typeChartData.values.length > 0" class="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-center">
            <div>
              <EChartPie :data="typeChartData" :height="280" :show-legend="false" />
            </div>
            <div>
              <div class="space-y-3">
                <div v-for="(item, index) in typeSummary" :key="index" class="flex items-center gap-3">
                  <div class="h-3 w-3 shrink-0 rounded-full" :style="{ backgroundColor: getTypeColor(index) }" />
                  <div class="min-w-20 shrink-0 text-sm text-gray-700 dark:text-gray-300">{{ item.name }}</div>
                  <div class="flex-1">
                    <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        class="h-full rounded-full transition-all"
                        :style="{ width: `${item.percentage}%`, backgroundColor: getTypeColor(index) }"
                      />
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <span class="text-sm font-medium text-gray-900 dark:text-white">
                      {{ item.count.toLocaleString() }}
                    </span>
                    <span class="ml-1 text-xs text-gray-400">({{ item.percentage }}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="flex h-48 items-center justify-center text-gray-400">
            {{ t('views.message.noData') }}
          </div>
        </div>
      </SectionCard>

      <!-- 时间分布图表（小时 & 星期） -->
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

      <!-- 时间分布图表（月份 & 年份） -->
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

      <!-- 消息长度分布 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard :title="t('views.message.lengthDetailTitle')" :show-divider="false">
          <template #headerRight>
            <span class="text-xs text-gray-400">{{ t('views.message.lengthDetailHint') }}</span>
          </template>
          <div class="p-5">
            <EChartBar
              v-if="lengthDetailChartData.values.some((v) => v > 0)"
              :data="lengthDetailChartData"
              :height="200"
            />
            <div v-else class="flex h-48 items-center justify-center text-gray-400">
              {{ t('views.message.noTextMessages') }}
            </div>
          </div>
        </SectionCard>

        <SectionCard :title="t('views.message.lengthGroupedTitle')" :show-divider="false">
          <template #headerRight>
            <span class="text-xs text-gray-400">{{ t('views.message.lengthGroupedHint') }}</span>
          </template>
          <div class="p-5">
            <EChartBar
              v-if="lengthGroupedChartData.values.some((v) => v > 0)"
              :data="lengthGroupedChartData"
              :height="200"
            />
            <div v-else class="flex h-48 items-center justify-center text-gray-400">
              {{ t('views.message.noTextMessages') }}
            </div>
          </div>
        </SectionCard>
      </div>

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
    </template>
  </div>
</template>
