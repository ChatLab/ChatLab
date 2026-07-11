<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { CardCaptureOverlay, CardDecoration, ThemeCard } from '@/components/UI'
import type { HourlyActivity, WeekdayActivity, DailyActivity } from '@openchatlab/core'
import dayjs from 'dayjs'

echarts.use([BarChart, GridComponent, CanvasRenderer])

const { t } = useI18n()
const isDark = useDark()

const props = defineProps<{
  hourlyActivity: HourlyActivity[]
  weekdayActivity: WeekdayActivity[]
  dailyActivity: DailyActivity[]
}>()

const activeDays = computed(() => props.dailyActivity.filter((d) => d.messageCount > 0).length)
const totalMessages = computed(() => props.dailyActivity.reduce((sum, d) => sum + d.messageCount, 0))

const dateRange = computed(() => {
  if (props.dailyActivity.length === 0) return { first: '', last: '', days: 0 }
  const sorted = [...props.dailyActivity].sort((a, b) => a.date.localeCompare(b.date))
  const first = dayjs(sorted[0].date)
  const last = dayjs(sorted[sorted.length - 1].date)
  return {
    first: first.format('YYYY/MM/DD'),
    last: last.format('YYYY/MM/DD'),
    days: last.diff(first, 'day') + 1,
  }
})

const avgPerDay = computed(() => {
  if (activeDays.value === 0) return 0
  return Math.round(totalMessages.value / activeDays.value)
})

// 巅峰记录
const peakDay = computed(() => {
  if (props.dailyActivity.length === 0) return null
  return props.dailyActivity.reduce((max, d) => (d.messageCount > max.messageCount ? d : max), props.dailyActivity[0])
})

// 最活跃时段 TOP3
const topHours = computed(() => {
  if (props.hourlyActivity.length === 0) return []
  return [...props.hourlyActivity].sort((a, b) => b.messageCount - a.messageCount).slice(0, 3)
})

// 时间性格标签（多维度分析）
const timePersonality = computed(() => {
  if (props.hourlyActivity.length === 0 && props.weekdayActivity.length === 0) return null

  // 活跃覆盖率
  const coverage = dateRange.value.days > 0 ? activeDays.value / dateRange.value.days : 0

  // 周末 vs 工作日
  const weekendDays = props.weekdayActivity.filter((w) => w.weekday === 6 || w.weekday === 7)
  const weekdayDays = props.weekdayActivity.filter((w) => w.weekday >= 1 && w.weekday <= 5)
  const weekendTotal = weekendDays.reduce((s, d) => s + d.messageCount, 0)
  const weekdayTotal = weekdayDays.reduce((s, d) => s + d.messageCount, 0)
  const total = weekendTotal + weekdayTotal
  const wkendPct = total > 0 ? weekendTotal / total : 0

  // 晚间(18-24) vs 白天(6-18) vs 深夜(0-6) 消息量
  const hourTotal = props.hourlyActivity.reduce((s, h) => s + h.messageCount, 0)
  const nightCount = props.hourlyActivity
    .filter((h) => h.hour >= 22 || h.hour < 5)
    .reduce((s, h) => s + h.messageCount, 0)
  const eveningCount = props.hourlyActivity
    .filter((h) => h.hour >= 18 && h.hour < 22)
    .reduce((s, h) => s + h.messageCount, 0)
  const nightPct = hourTotal > 0 ? nightCount / hourTotal : 0
  const eveningPct = hourTotal > 0 ? eveningCount / hourTotal : 0

  // 优先级判断：选最显著的特征
  if (coverage >= 0.9) {
    return { label: t('views.message.timeCard.personalityEveryday'), icon: 'i-heroicons-fire' }
  }
  if (wkendPct >= 0.55) {
    return { label: t('views.message.timeCard.personalityWeekend'), icon: 'i-heroicons-calendar' }
  }
  if (wkendPct <= 0.2 && total > 0) {
    return { label: t('views.message.timeCard.personalityWeekday'), icon: 'i-heroicons-briefcase' }
  }
  if (nightPct >= 0.3) {
    return { label: t('views.message.timeCard.personalityNightOwl'), icon: 'i-heroicons-moon' }
  }
  if (eveningPct >= 0.4) {
    return { label: t('views.message.timeCard.personalityEveningChat'), icon: 'i-heroicons-sparkles' }
  }

  // 兜底：根据高峰时段
  const peak = [...props.hourlyActivity].sort((a, b) => b.messageCount - a.messageCount)[0]
  if (!peak) return null
  if (peak.hour >= 5 && peak.hour < 9) {
    return { label: t('views.message.timeCard.personalityEarlyBird'), icon: 'i-heroicons-sun' }
  }
  if (peak.hour >= 12 && peak.hour < 14) {
    return { label: t('views.message.timeCard.personalityLunchChat'), icon: 'i-heroicons-clock' }
  }
  return { label: t('views.message.timeCard.personalityDaytime'), icon: 'i-heroicons-sun' }
})

// 周末 vs 工作日
const weekendRatio = computed(() => {
  const weekendDays = props.weekdayActivity.filter((w) => w.weekday === 6 || w.weekday === 7)
  const weekdayDays = props.weekdayActivity.filter((w) => w.weekday >= 1 && w.weekday <= 5)
  const weekendTotal = weekendDays.reduce((s, d) => s + d.messageCount, 0)
  const weekdayTotal = weekdayDays.reduce((s, d) => s + d.messageCount, 0)
  const total = weekendTotal + weekdayTotal
  if (total === 0) return 0
  return Math.round((weekendTotal / total) * 100)
})

const weekdayNames = computed(() => [
  t('common.weekday.mon'),
  t('common.weekday.tue'),
  t('common.weekday.wed'),
  t('common.weekday.thu'),
  t('common.weekday.fri'),
  t('common.weekday.sat'),
  t('common.weekday.sun'),
])

const peakWeekday = computed(() => {
  if (props.weekdayActivity.length === 0) return null
  const peak = [...props.weekdayActivity].sort((a, b) => b.messageCount - a.messageCount)[0]
  return { name: weekdayNames.value[peak.weekday - 1], count: peak.messageCount }
})

// 指标卡片
interface MetricItem {
  icon: string
  label: string
  value: string
  subtext: string
  colorClass: string
}

const metricItems = computed<MetricItem[]>(() => [
  {
    icon: 'i-heroicons-fire',
    label: t('views.message.timeCard.peakRecord'),
    value: peakDay.value ? dayjs(peakDay.value.date).format('MM/DD') : '-',
    subtext: peakDay.value ? t('views.message.timeCard.peakRecordDesc', { count: peakDay.value.messageCount }) : '',
    colorClass: 'text-red-600 dark:text-red-400',
  },
  {
    icon: 'i-heroicons-clock',
    label: t('views.message.timeCard.topHoursLabel'),
    value: topHours.value.length > 0 ? `${topHours.value[0].hour}:00` : '-',
    subtext: topHours.value.length >= 2 ? topHours.value.map((h) => `${h.hour}:00`).join(' > ') : '',
    colorClass: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    icon: 'i-heroicons-calendar-days',
    label: t('views.message.timeCard.peakWeekdayLabel'),
    value: peakWeekday.value?.name || '-',
    subtext: peakWeekday.value ? `${peakWeekday.value.count.toLocaleString()}` : '',
    colorClass: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: 'i-heroicons-building-office',
    label: t('views.message.timeCard.weekendRatio'),
    value: `${weekendRatio.value}%`,
    subtext: t('views.message.timeCard.weekendRatioDesc'),
    colorClass: 'text-amber-600 dark:text-amber-400',
  },
])

// 迷你 24h 柱状图
const barRef = ref<HTMLElement | null>(null)
let barInstance: echarts.ECharts | null = null

function initBar() {
  if (!barRef.value) return
  barInstance = echarts.init(barRef.value, undefined, { renderer: 'canvas' })
  updateBar()
}

function updateBar() {
  if (!barInstance) return

  const hourMap = new Map(props.hourlyActivity.map((h) => [h.hour, h.messageCount]))
  const data: number[] = []
  for (let i = 0; i < 24; i++) data.push(hourMap.get(i) || 0)

  const maxVal = Math.max(...data, 1)
  const barColors = data.map((v) => {
    const ratio = v / maxVal
    if (ratio > 0.8) return isDark.value ? '#f472b6' : '#ec4899'
    if (ratio > 0.5) return isDark.value ? '#a78bfa' : '#8b5cf6'
    return isDark.value ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'
  })

  barInstance.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => `${params[0].axisValue}:00 — ${params[0].value}`,
      },
      grid: { left: 0, right: 0, top: 4, bottom: 16 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 9,
          color: isDark.value ? '#6b7280' : '#9ca3af',
          interval: (idx: number) => idx % 6 === 0,
        },
      },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'bar',
          data: data.map((v, i) => ({ value: v, itemStyle: { color: barColors[i] } })),
          barWidth: '60%',
          itemStyle: { borderRadius: [2, 2, 0, 0] },
        },
      ],
    },
    { notMerge: true }
  )
}

function handleResize() {
  barInstance?.resize()
}

watch(
  () => props.hourlyActivity,
  () => updateBar()
)

watch(isDark, () => {
  barInstance?.dispose()
  initBar()
})

onMounted(() => {
  initBar()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  barInstance?.dispose()
})
</script>

<template>
  <ThemeCard data-capturable-card class="group/card relative isolate flex flex-col">
    <CardDecoration />
    <CardCaptureOverlay />
    <!-- 主视觉区域 -->
    <div class="relative z-10 px-6 pt-8 pb-4 sm:px-8">
      <div class="flex items-start gap-6 sm:gap-10">
        <!-- 左侧：叙事文字 -->
        <div class="min-w-0 flex-1">
          <div class="flex flex-col text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
            <!-- 日期范围 -->
            <p v-if="dateRange.first" class="mb-2 text-sm font-medium tracking-wide text-gray-500 dark:text-gray-400">
              {{ dateRange.first }} – {{ dateRange.last }}
            </p>

            <!-- 第一行：活跃天数 -->
            <div class="mb-3 flex items-baseline gap-2">
              <span class="font-black text-5xl tracking-tight text-gray-900 dark:text-white">
                {{ dateRange.days }}
              </span>
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('views.message.timeCard.heroDaysIn') }}
              </span>
              <span class="font-bold text-3xl text-indigo-500 dark:text-indigo-400">
                {{ activeDays }}
              </span>
              <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                {{ t('views.message.timeCard.heroDaysActive') }}
              </span>
            </div>

            <!-- 第二行：平均每天 + 时间性格 -->
            <div class="flex items-baseline flex-wrap gap-x-1.5 gap-y-1">
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('views.message.timeCard.heroAvgPrefix') }}
              </span>
              <span class="font-bold text-xl text-pink-500 dark:text-pink-400">
                {{ avgPerDay }}
              </span>
              <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                {{ t('views.message.timeCard.heroAvgSuffix') }}
              </span>
              <template v-if="timePersonality">
                <UIcon :name="timePersonality.icon" class="ml-2 h-4 w-4 text-amber-500" />
                <span class="text-base font-medium text-amber-600 dark:text-amber-400">
                  {{ timePersonality.label }}
                </span>
              </template>
            </div>
          </div>
        </div>

        <!-- 右侧：24h 迷你柱状图 -->
        <div class="flex shrink-0 flex-col items-center">
          <div class="mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">
            {{ t('views.message.timeCard.hourlyDistribution') }}
          </div>
          <div ref="barRef" style="width: 180px; height: 110px" />
        </div>
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="relative z-10 px-6 pb-6 pt-4 sm:px-8">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Time Profile
        </span>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="item in metricItems"
          :key="item.icon + item.label"
          class="flex min-w-0 items-start gap-2 px-2.5 py-2"
        >
          <UIcon :name="item.icon" class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="item.colorClass" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm font-black leading-tight tabular-nums" :class="item.colorClass">
              {{ item.value }}
            </div>
            <div class="mt-0.5 truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {{ item.label }}
            </div>
            <div class="mt-0.5 truncate text-[9px] text-gray-400 dark:text-gray-500">
              {{ item.subtext }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 水印 -->
    <div
      class="relative z-10 flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
    >
      <div class="flex items-center gap-1.5">
        <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
        <span class="text-[10px] font-bold uppercase tracking-wider">ChatLab</span>
      </div>
      <span class="text-[9px] font-medium uppercase tracking-widest">
        {{ t('views.message.timeCard.watermark') }}
      </span>
    </div>
  </ThemeCard>
</template>
