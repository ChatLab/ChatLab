<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RelationshipStats } from '@/types/analysis'
import { useDataService } from '@/services'
import { ReportCard, SectionCard, EmptyState, LoadingState, Tabs } from '@/components/UI'
import { EChart } from '@/components/charts'
import RelationshipMetricCard from './RelationshipMetricCard.vue'
import type { EChartsOption } from 'echarts'
import type { TimeFilter } from '@openchatlab/shared-types'

const { t, locale } = useI18n()

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const stats = ref<RelationshipStats | null>(null)
const isLoading = ref(false)
const isPerseveranceLoading = ref(false)
const trajectoryMetric = ref<'activity' | 'response' | 'perseverance'>('activity')
const showAllMonths = ref(false)

// 锲而不舍阈值（秒），默认 300（5分钟）
const perseveranceThreshold = ref(300)

async function loadData(options?: { localOnly?: 'perseverance' }) {
  if (!props.sessionId) return
  const isPerseveranceOnly = options?.localOnly === 'perseverance'
  if (isPerseveranceOnly) {
    isPerseveranceLoading.value = true
  } else {
    isLoading.value = true
  }
  try {
    stats.value = await useDataService().getRelationshipStats(props.sessionId, props.timeFilter, {
      perseveranceThreshold: perseveranceThreshold.value,
    })
  } catch (error) {
    console.error('Failed to load relationship stats:', error)
  } finally {
    if (isPerseveranceOnly) {
      isPerseveranceLoading.value = false
    } else {
      isLoading.value = false
    }
  }
}

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)

// 阈值预设选项
const thresholdOptions = [
  { label: '1m', value: 60 },
  { label: '3m', value: 180 },
  { label: '5m', value: 300 },
  { label: '10m', value: 600 },
  { label: '30m', value: 1800 },
]

function onThresholdChange(val: number) {
  if (perseveranceThreshold.value === val) return
  perseveranceThreshold.value = val
  loadData({ localOnly: 'perseverance' })
}

const perseveranceThresholdModel = computed({
  get: () => perseveranceThreshold.value,
  set: (val: number) => onThresholdChange(val),
})

function getPerseveranceThresholdText(seconds: number): string {
  return t('views.relationship.perseverance.thresholdMinutes', { n: Math.round(seconds / 60) })
}

const perseveranceHintText = computed(() =>
  t('views.relationship.perseverance.hintWithThreshold', {
    threshold: getPerseveranceThresholdText(perseveranceThreshold.value),
  })
)

const hasData = computed(() => stats.value?.hasSessionIndex && stats.value.totalSessions > 0)

const memberA = computed(() => stats.value?.members[0])
const memberB = computed(() => stats.value?.members[1])

// ==================== 发起者 ====================
const overallInitiateRatio = computed(() => {
  if (!memberA.value || !stats.value) return 50
  const totalInit = (memberA.value.totalInitiateCount ?? 0) + (memberB.value?.totalInitiateCount ?? 0)
  if (totalInit === 0) return 50
  return Math.round((memberA.value.totalInitiateCount / totalInit) * 100)
})

const timeRangeString = computed(() => {
  if (!stats.value || stats.value.months.length === 0) return ''
  const sorted = [...stats.value.months].sort((a, b) => a.month.localeCompare(b.month))
  const first = sorted[0].month.replace('-', '/')
  const last = sorted[sorted.length - 1].month.replace('-', '/')
  if (first === last) return first
  return `${first} – ${last}`
})

const heroTextMaxWidthClass = computed(() => (locale.value.startsWith('en') ? 'max-w-[420px]' : 'max-w-[320px]'))

// ==================== 趋势折线图 ====================
const trendChartOption = computed<EChartsOption>(() => {
  if (!stats.value || stats.value.months.length === 0 || !memberA.value) return {}

  const sortedMonths = [...stats.value.months].sort((a, b) => a.month.localeCompare(b.month))
  const xData = sortedMonths.map((m) => formatMonthShort(m.month))

  const aName = memberA.value.name
  const bName = memberB.value?.name ?? '—'

  const aInitData = sortedMonths.map((m) => {
    const aStats = m.members.find((mem) => mem.memberId === memberA.value!.memberId)
    if (!aStats || m.totalSessions === 0) return 50
    return Math.round((aStats.initiateCount / m.totalSessions) * 100)
  })

  return {
    tooltip: {
      trigger: 'axis',
      formatter(params: any) {
        const p = params[0]
        const val = p.value as number
        return `${p.axisValue}<br/>${aName}: ${val}%<br/>${bName}: ${100 - val}%`
      },
    },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: xData, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%', fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        data: aInitData,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: '#3b82f6' },
        itemStyle: { color: '#3b82f6' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59, 130, 246, 0.15)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          data: [{ yAxis: 50, lineStyle: { type: 'dashed', color: '#9ca3af' } }],
          label: { show: false },
          symbol: 'none',
        },
      },
    ],
  }
})

// ==================== 月度互动轨迹 ====================
function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  return t('views.relationship.monthFormat', { year, month: Number.parseInt(month, 10) })
}

function formatMonthShort(monthStr: string): string {
  const parts = monthStr.split('-')
  return t('views.relationship.monthShortFormat', { month: Number.parseInt(parts[1], 10) })
}

function getIceBreakCount(memberId?: number): number {
  if (!memberId || !stats.value?.iceBreakers?.length) return 0
  return stats.value.iceBreakers.filter((ib) => ib.memberId === memberId).reduce((sum, ib) => sum + ib.count, 0)
}

function getAvgResponseTime(memberId?: number): number | null {
  if (!memberId || !stats.value?.responseLatency?.length) return null
  const item = stats.value.responseLatency.find((rl) => rl.memberId === memberId)
  return item ? item.avgResponseTime : null
}

function getPerseveranceCount(memberId?: number): number {
  if (!memberId || !stats.value?.perseverance?.length) return 0
  const item = stats.value.perseverance.find((p) => p.memberId === memberId)
  return item?.totalDoubleTexts ?? 0
}

function formatResponseByMember(memberId?: number): string {
  const avg = getAvgResponseTime(memberId)
  return avg != null ? formatDuration(avg) : '--'
}

// 月度响应时延
function getMonthResponseLatency(month: string) {
  return stats.value?.monthlyResponseLatency?.find((m) => m.month === month)?.members ?? []
}

// 月度锲而不舍
function getMonthPerseverance(month: string) {
  return stats.value?.monthlyPerseverance?.find((m) => m.month === month)?.members ?? []
}

function getMemberResponseLatency(month: string, memberId?: number): number | null {
  if (!memberId) return null
  const rl = getMonthResponseLatency(month).find((r) => r.memberId === memberId)
  return rl?.avgResponseTime ?? null
}

function formatMemberResponseLatency(month: string, memberId?: number): string {
  const value = getMemberResponseLatency(month, memberId)
  return value == null ? '—' : formatDuration(value)
}

function getMemberPerseverance(month: string, memberId?: number): number {
  if (!memberId) return 0
  const p = getMonthPerseverance(month).find((p) => p.memberId === memberId)
  return p?.doubleTextCount ?? 0
}

function getMonthIceBreakCount(month: string): number {
  return (
    stats.value?.iceBreakers?.filter((item) => item.month === month).reduce((sum, item) => sum + item.count, 0) ?? 0
  )
}

function getMonthAverageResponse(month: string): number | null {
  const responses = getMonthResponseLatency(month)
  const totalResponses = responses.reduce((sum, item) => sum + item.responseCount, 0)
  if (totalResponses === 0) return null
  return responses.reduce((sum, item) => sum + item.avgResponseTime * item.responseCount, 0) / totalResponses
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds))
  if (totalSeconds < 60) return t('views.relationship.responseLatency.seconds', { n: totalSeconds })
  if (totalSeconds < 3600) {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return t('views.relationship.responseLatency.minutesSeconds', { m: mins, s: secs })
  }
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  if (mins === 0) return t('views.relationship.responseLatency.hours', { n: hours })
  return t('views.relationship.responseLatency.hoursMinutes', { h: hours, m: mins })
}

const sortedMonths = computed(() => [...(stats.value?.months ?? [])].sort((a, b) => a.month.localeCompare(b.month)))

const trajectoryTabs = computed(() => [
  { label: t('views.relationship.trajectory.metrics.activity'), value: 'activity' },
  { label: t('views.relationship.trajectory.metrics.response'), value: 'response' },
  { label: t('views.relationship.trajectory.metrics.perseverance'), value: 'perseverance' },
])

const trajectoryChartOption = computed<EChartsOption>(() => {
  const months = sortedMonths.value
  const spansMultipleYears = new Set(months.map((month) => month.month.slice(0, 4))).size > 1
  const xData = months.map((month) =>
    spansMultipleYears ? month.month.replace('-', '/') : formatMonthShort(month.month)
  )
  const baseOption: EChartsOption = {
    color: ['#3b82f6', '#ec4899'],
    tooltip: { trigger: 'axis' },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 52, right: 24, top: 44, bottom: 34 },
    xAxis: {
      type: 'category',
      data: xData,
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
  }

  if (trajectoryMetric.value === 'activity') {
    return {
      ...baseOption,
      series: [
        {
          name: t('views.relationship.trajectory.conversations'),
          type: 'bar',
          data: months.map((month) => month.totalSessions),
          barMaxWidth: 32,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
        {
          name: t('views.relationship.trajectory.iceBreaks'),
          type: 'line',
          data: months.map((month) => getMonthIceBreakCount(month.month)),
          smooth: true,
          symbolSize: 7,
          lineStyle: { width: 2 },
        },
      ],
    }
  }

  if (trajectoryMetric.value === 'response') {
    return {
      ...baseOption,
      tooltip: {
        trigger: 'axis',
        valueFormatter(value) {
          return typeof value === 'number' ? formatDuration(value) : String(value ?? '—')
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          fontSize: 11,
          formatter(value: number) {
            return formatDuration(value)
          },
        },
        splitLine: { lineStyle: { type: 'dashed' } },
      },
      series: [
        {
          name: memberA.value?.name ?? '—',
          type: 'line',
          data: months.map((month) => getMemberResponseLatency(month.month, memberA.value?.memberId)),
          connectNulls: false,
          smooth: true,
          symbolSize: 7,
          lineStyle: { width: 2 },
        },
        {
          name: memberB.value?.name ?? '—',
          type: 'line',
          data: months.map((month) => getMemberResponseLatency(month.month, memberB.value?.memberId)),
          connectNulls: false,
          smooth: true,
          symbolSize: 7,
          lineStyle: { width: 2 },
        },
      ],
    }
  }

  return {
    ...baseOption,
    series: [
      {
        name: memberA.value?.name ?? '—',
        type: 'bar',
        data: months.map((month) => getMemberPerseverance(month.month, memberA.value?.memberId)),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
      {
        name: memberB.value?.name ?? '—',
        type: 'bar',
        data: months.map((month) => getMemberPerseverance(month.month, memberB.value?.memberId)),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
})

const keyMoments = computed(() => {
  const activityPeak = sortedMonths.value.reduce<(typeof sortedMonths.value)[number] | null>(
    (peak, month) => (!peak || month.totalSessions > peak.totalSessions ? month : peak),
    null
  )
  const iceBreakPeak = sortedMonths.value
    .map((month) => ({ month: month.month, count: getMonthIceBreakCount(month.month) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)[0]
  const responsePeak = sortedMonths.value
    .map((month) => ({ month: month.month, value: getMonthAverageResponse(month.month) }))
    .filter((item): item is { month: string; value: number } => item.value != null)
    .sort((a, b) => a.value - b.value)[0]

  return [
    activityPeak && activityPeak.totalSessions > 0
      ? {
          icon: 'i-heroicons-chart-bar-square-solid',
          iconClass: 'bg-blue-50 text-blue-500 dark:bg-blue-500/10 dark:text-blue-400',
          title: t('views.relationship.trajectory.activityPeak'),
          month: formatMonth(activityPeak.month),
          detail: t('views.relationship.trajectory.activityPeakDetail', { count: activityPeak.totalSessions }),
        }
      : null,
    iceBreakPeak
      ? {
          icon: 'i-heroicons-fire-solid',
          iconClass: 'bg-pink-50 text-pink-500 dark:bg-pink-500/10 dark:text-pink-400',
          title: t('views.relationship.trajectory.iceBreakPeak'),
          month: formatMonth(iceBreakPeak.month),
          detail: t('views.relationship.trajectory.iceBreakPeakDetail', {
            count: iceBreakPeak.count,
          }),
        }
      : null,
    responsePeak
      ? {
          icon: 'i-heroicons-clock-solid',
          iconClass: 'bg-blue-50 text-blue-500 dark:bg-blue-500/10 dark:text-blue-400',
          title: t('views.relationship.trajectory.fastestResponse'),
          month: formatMonth(responsePeak.month),
          detail: t('views.relationship.trajectory.fastestResponseDetail', {
            duration: formatDuration(responsePeak.value),
          }),
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item != null)
})
</script>

<template>
  <div :class="isLoading ? 'h-full' : ''">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />
    <div v-else class="main-content mx-auto max-w-[920px] space-y-6 p-4 sm:p-6">
      <!-- 无数据 -->
      <EmptyState
        v-if="stats && !hasData"
        icon="i-heroicons-heart"
        :title="t('views.relationship.empty.title')"
        :description="t('views.relationship.empty.description')"
      />

      <!-- 有数据 -->
      <template v-else-if="stats && hasData">
        <div class="space-y-6">
          <!-- 关系卡片 -->
          <ReportCard id="shareable-poster">
            <!-- 1. 主视觉区域 (Primary Module) -->
            <div
              class="relative z-10 flex flex-col items-center justify-center gap-10 px-6 pt-10 pb-6 sm:px-8 lg:flex-row lg:items-start lg:justify-between lg:gap-8 xl:gap-12"
            >
              <!-- 左侧：文字描述与基础数据 -->
              <div class="flex min-w-0 max-w-full flex-1 flex-col items-center justify-center lg:items-start">
                <div class="flex w-fit min-w-0 flex-col items-start text-left" :class="heroTextMaxWidthClass">
                  <div class="flex flex-col text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
                    <p class="mb-2 text-sm font-medium tracking-wide text-gray-500 dark:text-gray-400">
                      {{ timeRangeString }}
                    </p>

                    <div class="mb-4 flex min-w-0 flex-wrap items-baseline gap-2">
                      <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                        {{ t('views.relationship.hero.totalSessionsPrefix') }}
                      </span>
                      <span class="font-black text-5xl tracking-tight text-gray-900 dark:text-white">
                        {{ stats.totalSessions }}
                      </span>
                      <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
                        {{ t('views.relationship.hero.totalSessionsSuffix') }}
                      </span>
                    </div>

                    <div class="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1">
                      <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                        {{ t('views.relationship.hero.initiativePrefix') }}
                      </span>
                      <span class="font-black text-3xl text-pink-500 dark:text-pink-400">
                        {{ overallInitiateRatio >= 50 ? overallInitiateRatio : 100 - overallInitiateRatio }}%
                      </span>
                      <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                        {{ t('views.relationship.hero.initiativeByPrefix') }}
                      </span>
                      <span class="max-w-full break-all text-xl font-bold leading-snug text-gray-900 dark:text-white">
                        {{ overallInitiateRatio >= 50 ? memberA?.name : memberB?.name }}
                      </span>
                      <span class="text-base font-medium text-gray-600 dark:text-gray-300">
                        {{ t('views.relationship.hero.initiativeBySuffix') }}
                      </span>
                    </div>
                  </div>

                  <!-- VS Stats -->
                  <div class="mt-8 flex w-full max-w-[320px] items-center justify-between gap-4">
                    <div class="flex flex-1 flex-col items-center overflow-hidden">
                      <div
                        class="w-full truncate text-center text-xs font-bold text-gray-500 dark:text-gray-400"
                        :title="memberA?.name"
                      >
                        {{ memberA?.name }}
                      </div>
                      <div class="mt-1 text-2xl font-black text-blue-500 dark:text-blue-400">
                        {{ memberA?.totalInitiateCount }}
                      </div>
                      <div class="mt-0.5 text-[10px] font-medium text-gray-400">
                        {{ t('views.relationship.hero.initiateTimes') }}
                      </div>
                    </div>

                    <div
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 font-black text-[10px] italic text-gray-400 shadow-inner dark:bg-page-dark/80 dark:text-gray-500"
                    >
                      VS
                    </div>

                    <div class="flex flex-1 flex-col items-center overflow-hidden">
                      <div
                        class="w-full truncate text-center text-xs font-bold text-gray-500 dark:text-gray-400"
                        :title="memberB?.name"
                      >
                        {{ memberB?.name }}
                      </div>
                      <div class="mt-1 text-2xl font-black text-pink-500 dark:text-pink-400">
                        {{ memberB?.totalInitiateCount }}
                      </div>
                      <div class="mt-0.5 text-[10px] font-medium text-gray-400">
                        {{ t('views.relationship.hero.initiateTimes') }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 右侧：主动性趋势图 -->
              <div
                v-if="stats.months.length >= 2"
                class="flex min-w-0 w-full max-w-[400px] flex-1 flex-col justify-center lg:max-w-[460px]"
              >
                <div class="mb-2 flex items-center justify-between px-1">
                  <span class="text-sm font-bold text-gray-900 dark:text-white">
                    {{ t('views.relationship.trend.title') }}
                  </span>
                  <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                    {{ t('views.relationship.trend.hint', { name: memberA?.name ?? '' }) }}
                  </span>
                </div>
                <div class="w-full">
                  <div class="h-[200px] w-full">
                    <EChart :option="trendChartOption" :height="200" />
                  </div>
                </div>
              </div>
            </div>

            <!-- 2. 四个次要模块 (4 Secondary Modules) -->
            <div class="relative z-10 grid grid-cols-2 gap-3 p-4 pt-2 sm:p-6 sm:pt-2 lg:grid-cols-4">
              <RelationshipMetricCard
                :title="t('views.relationship.closerTitle')"
                icon-name="i-heroicons-hand-raised-solid"
                icon-bg-class="bg-blue-100 dark:bg-blue-500/20"
                icon-color-class="text-blue-600 dark:text-blue-400"
                :left-name="memberA?.name"
                :left-value="memberA?.totalCloseCount ?? 0"
                :right-name="memberB?.name"
                :right-value="memberB?.totalCloseCount ?? 0"
                value-class="text-lg text-blue-600 dark:text-blue-400"
                :description="t('views.relationship.closerHint')"
              />

              <RelationshipMetricCard
                :title="t('views.relationship.iceBreaker.title')"
                icon-name="i-heroicons-fire-solid"
                icon-bg-class="bg-pink-100 dark:bg-pink-500/20"
                icon-color-class="text-pink-600 dark:text-pink-400"
                :left-name="memberA?.name"
                :left-value="getIceBreakCount(memberA?.memberId)"
                :right-name="memberB?.name"
                :right-value="getIceBreakCount(memberB?.memberId)"
                value-class="text-lg text-pink-600 dark:text-pink-400"
                :description="t('views.relationship.iceBreaker.hint')"
              />

              <RelationshipMetricCard
                :title="t('views.relationship.responseLatency.title')"
                icon-name="i-heroicons-clock-solid"
                icon-bg-class="bg-amber-100 dark:bg-amber-500/20"
                icon-color-class="text-amber-600 dark:text-amber-400"
                :left-name="memberA?.name"
                :left-value="formatResponseByMember(memberA?.memberId)"
                :right-name="memberB?.name"
                :right-value="formatResponseByMember(memberB?.memberId)"
                value-class="text-base text-amber-600 dark:text-amber-400"
                :description="t('views.relationship.responseLatency.hint')"
              />

              <RelationshipMetricCard
                :title="t('views.relationship.perseverance.title')"
                icon-name="i-heroicons-arrow-path-solid"
                icon-bg-class="bg-purple-100 dark:bg-purple-500/20"
                icon-color-class="text-purple-600 dark:text-purple-400"
                :left-name="memberA?.name"
                :left-value="getPerseveranceCount(memberA?.memberId)"
                :right-name="memberB?.name"
                :right-value="getPerseveranceCount(memberB?.memberId)"
                value-class="text-lg text-purple-600 dark:text-purple-400"
                :description="perseveranceHintText"
              >
                <template #header-extra>
                  <USelect
                    v-model="perseveranceThresholdModel"
                    :items="thresholdOptions"
                    value-key="value"
                    size="xs"
                    class="relative z-[120] w-16"
                    :ui="{ content: 'z-[121]' }"
                    :disabled="isPerseveranceLoading"
                  />
                </template>
              </RelationshipMetricCard>
            </div>

            <!-- Share Footer / Watermark -->
            <div
              class="relative z-10 flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
            >
              <div class="flex items-center gap-1.5">
                <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
                <span class="text-[10px] font-bold uppercase tracking-wider">ChatLab</span>
              </div>
              <span class="text-[9px] font-medium uppercase tracking-widest">
                {{ t('views.relationship.watermarkReport') }}
              </span>
            </div>
          </ReportCard>
        </div>

        <!-- 互动轨迹：趋势优先，月度数值按需展开 -->
        <SectionCard
          :title="t('views.relationship.trajectory.title')"
          :description="t('views.relationship.trajectory.description')"
          :show-divider="false"
        >
          <template #headerRight>
            <Tabs v-model="trajectoryMetric" :items="trajectoryTabs" size="sm" class="max-w-[58vw] sm:max-w-none" />
          </template>

          <div class="px-4 pb-5 sm:px-6 sm:pb-6">
            <EChart :option="trajectoryChartOption" :height="280" />

            <div v-if="keyMoments.length > 0" class="mt-6">
              <p class="mb-3 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
                {{ t('views.relationship.trajectory.keyMoments') }}
              </p>
              <div class="grid gap-x-8 gap-y-4 sm:grid-cols-3">
                <div v-for="moment in keyMoments" :key="moment.title" class="flex min-w-0 items-start gap-3 py-1">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="moment.iconClass">
                    <UIcon :name="moment.icon" class="h-4 w-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ moment.title }}</p>
                    <p
                      class="mt-0.5 truncate text-sm font-semibold text-gray-900 dark:text-white"
                      :title="moment.month"
                    >
                      {{ moment.month }}
                    </p>
                    <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ moment.detail }}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-5 flex justify-center">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                :icon="showAllMonths ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                @click="showAllMonths = !showAllMonths"
              >
                {{
                  showAllMonths
                    ? t('views.relationship.trajectory.hideAll')
                    : t('views.relationship.trajectory.showAll')
                }}
              </UButton>
            </div>

            <div
              v-if="showAllMonths"
              class="mt-3 overflow-x-auto rounded-lg border border-gray-200/80 dark:border-white/10"
            >
              <table class="min-w-full text-left text-sm">
                <thead class="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                  <tr>
                    <th scope="col" class="px-4 py-2.5 font-medium">
                      {{ t('views.relationship.trajectory.month') }}
                    </th>
                    <template v-if="trajectoryMetric === 'activity'">
                      <th scope="col" class="px-4 py-2.5 text-right font-medium">
                        {{ t('views.relationship.trajectory.conversations') }}
                      </th>
                      <th scope="col" class="px-4 py-2.5 text-right font-medium">
                        {{ t('views.relationship.trajectory.iceBreaks') }}
                      </th>
                    </template>
                    <template v-else>
                      <th scope="col" class="max-w-[180px] truncate px-4 py-2.5 text-right font-medium">
                        {{ memberA?.name }}
                      </th>
                      <th scope="col" class="max-w-[180px] truncate px-4 py-2.5 text-right font-medium">
                        {{ memberB?.name }}
                      </th>
                    </template>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-white/5">
                  <tr v-for="month in [...sortedMonths].reverse()" :key="month.month">
                    <td class="whitespace-nowrap px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300">
                      {{ formatMonth(month.month) }}
                    </td>
                    <template v-if="trajectoryMetric === 'activity'">
                      <td class="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {{ month.totalSessions }}
                      </td>
                      <td class="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {{ getMonthIceBreakCount(month.month) }}
                      </td>
                    </template>
                    <template v-else-if="trajectoryMetric === 'response'">
                      <td
                        class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400"
                      >
                        {{ formatMemberResponseLatency(month.month, memberA?.memberId) }}
                      </td>
                      <td
                        class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400"
                      >
                        {{ formatMemberResponseLatency(month.month, memberB?.memberId) }}
                      </td>
                    </template>
                    <template v-else>
                      <td class="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {{ getMemberPerseverance(month.month, memberA?.memberId) }}
                      </td>
                      <td class="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {{ getMemberPerseverance(month.month, memberB?.memberId) }}
                      </td>
                    </template>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      </template>
    </div>
  </div>
</template>
