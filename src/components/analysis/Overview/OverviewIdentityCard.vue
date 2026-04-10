<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { HeatmapChart } from 'echarts/charts'
import { CalendarComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import type { AnalysisSession } from '@/types/base'
import type { DailyActivity } from '@/types/analysis'
import { formatDateRange } from '@/utils'

echarts.use([HeatmapChart, CalendarComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

const { t, locale } = useI18n()
const isDark = useDark()

const props = defineProps<{
  session: AnalysisSession
  dailyActivity: DailyActivity[]
  totalDurationDays: number
  totalDailyAvgMessages: number
  timeRange: { start: number; end: number } | null
}>()

const chartRef = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

const fullTimeRangeText = computed(() => {
  if (!props.timeRange) return ''
  return formatDateRange(props.timeRange.start, props.timeRange.end, 'YYYY/MM/DD')
})

// 滚动 12 个月日期范围（与 GitHub 贡献图一致）
const calendarRange = computed(() => {
  const today = new Date()
  const yearAgo = new Date(today)
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  yearAgo.setDate(yearAgo.getDate() + 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return [fmt(yearAgo), fmt(today)]
})

// 转换 DailyActivity 为 ECharts 日历数据
const chartData = computed(() => {
  const [startStr, endStr] = calendarRange.value
  const startDate = new Date(startStr + 'T00:00:00Z')
  const endDate = new Date(endStr + 'T00:00:00Z')

  const dict = new Map<string, number>()
  props.dailyActivity
    .filter((d) => d.date >= startStr && d.date <= endStr)
    .forEach((d) => dict.set(d.date, d.messageCount))

  const res: any[] = []
  const curr = new Date(startDate)
  while (curr <= endDate) {
    const dStr = curr.toISOString().slice(0, 10)
    const val = dict.get(dStr) || 0
    res.push({
      value: [dStr, val],
      itemStyle: val === 0 ? { color: emptyColor.value } : undefined,
    })
    curr.setUTCDate(curr.getUTCDate() + 1)
  }
  return res
})

const maxValue = computed(() => {
  if (props.dailyActivity.length === 0) return 10
  return Math.max(...props.dailyActivity.map((d) => d.messageCount), 1)
})

const themeColors = {
  light: ['#fce4ec', '#f8a4b8', '#f06292', '#e91e63'],
  dark: ['#3d1f24', '#6b2f3a', '#a34557', '#ee4567'],
}

// GitHub 风格：标准的空白格底色
const emptyColor = computed(() => (isDark.value ? 'rgba(255, 255, 255, 0.03)' : '#ebedf0'))

const chartOption = computed<EChartsOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params: any) => {
      const date = params.value[0]
      const value = params.value[1]
      return `${date}<br/>${t('views.message.calendarTooltipMessages')}: ${value}`
    },
  },
  visualMap: {
    min: 1,
    max: maxValue.value,
    calculable: false,
    orient: 'horizontal',
    left: 'center',
    bottom: 0,
    itemWidth: 10,
    itemHeight: 80,
    text: [`${maxValue.value}`, '1'],
    inRange: {
      color: isDark.value ? themeColors.dark : themeColors.light,
    },
    textStyle: {
      color: isDark.value ? '#8b949e' : '#6b7280',
      fontSize: 10,
    },
    show: true,
  },
  calendar: {
    top: 20,
    left: 30,
    cellSize: [13, 13],
    range: calendarRange.value,
    itemStyle: {
      borderWidth: 0,
      color: 'transparent',
    },
    yearLabel: { show: false },
    monthLabel: {
      show: true,
      color: isDark.value ? '#8b949e' : '#6b7280',
      fontSize: 10,
      nameMap: [
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
      ],
    },
    dayLabel: {
      show: true,
      firstDay: 1,
      color: isDark.value ? '#8b949e' : '#9ca3af',
      fontSize: 10,
      nameMap: [
        t('common.weekday.sun'),
        t('common.weekday.mon'),
        t('common.weekday.tue'),
        t('common.weekday.wed'),
        t('common.weekday.thu'),
        t('common.weekday.fri'),
        t('common.weekday.sat'),
      ],
    },
    splitLine: { show: false },
  },
  series: [
    {
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: chartData.value,
      itemStyle: {
        borderRadius: 3,
        borderWidth: 2,
        borderColor: isDark.value ? 'transparent' : '#ffffff',
      },
    },
  ],
}))

function initChart() {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
  chartInstance.setOption({ backgroundColor: 'transparent', ...chartOption.value })
}

function updateChart() {
  if (!chartInstance) return
  chartInstance.setOption({ backgroundColor: 'transparent', ...chartOption.value }, { notMerge: true })
}

function handleResize() {
  chartInstance?.resize()
}

watch([() => props.dailyActivity, locale], () => updateChart())

watch(isDark, () => {
  chartInstance?.dispose()
  initChart()
})

onMounted(() => {
  initChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
})
</script>

<template>
  <div
    class="relative overflow-hidden rounded-[24px] border border-gray-200/60 bg-white p-8 shadow-sm dark:border-white/5 dark:bg-card-dark"
  >
    <div class="relative">
      <div class="flex flex-col">
        <!-- 上方：身份信息 + 统计数据 -->
        <div class="pb-2">
          <h2 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {{ session.name }}
          </h2>

          <div class="mt-4 flex items-start gap-6 sm:gap-24">
            <div class="min-w-0 flex flex-col gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
              <div class="flex items-center gap-2">
                <div class="flex h-6 w-6 shrink-0 items-center justify-center">
                  <UIcon v-if="session.type === 'group'" name="i-heroicons-user-group" class="h-4 w-4 opacity-70" />
                  <UIcon v-else name="i-heroicons-user" class="h-4 w-4 opacity-70" />
                </div>
                <span class="whitespace-nowrap">
                  {{ session.platform.toUpperCase() }}
                  ·
                  {{
                    session.type === 'private'
                      ? t('analysis.overview.identity.privateChat')
                      : t('analysis.overview.identity.groupChat')
                  }}
                </span>
              </div>

              <div v-if="fullTimeRangeText" class="flex items-center gap-2">
                <div class="flex h-6 w-6 shrink-0 items-center justify-center">
                  <UIcon name="i-heroicons-calendar" class="h-4 w-4 opacity-70" />
                </div>
                <span class="font-mono text-xs opacity-90 whitespace-nowrap">{{ fullTimeRangeText }}</span>
              </div>
            </div>

            <!-- 紧凑统计数据 -->
            <div class="flex shrink-0 gap-6">
              <div class="flex flex-col gap-1 text-center">
                <span class="text-2xl font-black font-mono tracking-tight text-gray-900 dark:text-white">
                  {{ session.messageCount.toLocaleString() }}
                </span>
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ t('analysis.overview.identity.totalMessages') }}
                </span>
              </div>

              <div class="flex flex-col gap-1 text-center">
                <span class="text-2xl font-black font-mono tracking-tight text-gray-900 dark:text-white">
                  {{ totalDurationDays.toLocaleString() }}
                </span>
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ t('analysis.overview.identity.durationDays') }}
                </span>
              </div>

              <div class="flex flex-col gap-1 text-center">
                <span class="text-2xl font-black font-mono tracking-tight text-gray-900 dark:text-white">
                  {{ totalDailyAvgMessages.toLocaleString() }}
                </span>
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ t('analysis.overview.identity.dailyAvgMessages') }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 热力图区域 -->
        <div class="pt-2">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Activity Heatmap
            </span>
          </div>
          <div class="overflow-x-auto overflow-y-hidden scrollbar-hide py-1">
            <div ref="chartRef" class="h-[140px] min-w-[700px] lg:w-full" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
