<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RelationshipStats, RelationshipMonthStats } from '@/types/analysis'
import { ThemeCard, SectionCard, EmptyState, LoadingState } from '@/components/UI'
import { EChart } from '@/components/charts'
import RelationshipMetricCard from './RelationshipMetricCard.vue'
import type { EChartsOption } from 'echarts'

const { t, locale } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const stats = ref<RelationshipStats | null>(null)
const isLoading = ref(false)
const isPerseveranceLoading = ref(false)

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
    stats.value = await window.chatApi.getRelationshipStats(props.sessionId, props.timeFilter, {
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

function getOverallLabel(): string {
  if (!stats.value || stats.value.totalSessions <= 3) {
    return t('views.relationship.labels.distantBond')
  }
  const ratio = overallInitiateRatio.value
  if (ratio >= 40 && ratio <= 60) return t('views.relationship.labels.mutualPursuit')
  if (ratio >= 80 || ratio <= 20) return t('views.relationship.labels.devotedHeart')
  return t('views.relationship.labels.silentGuardian')
}

// 确保进度条视觉上可区分（至少 5% 最小宽度）
function clampBarWidth(ratio: number): number {
  if (ratio <= 0) return 0
  if (ratio >= 100) return 100
  return Math.max(5, Math.min(95, ratio))
}

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

// ==================== 月度 helpers ====================
function getMonthLabel(month: RelationshipMonthStats): string {
  if (month.totalSessions === 0) return t('views.relationship.labels.peacefulSilence')
  if (month.totalSessions <= 2) return t('views.relationship.labels.fleetingThoughts')

  const sorted = [...month.members].sort((a, b) => b.initiateCount - a.initiateCount)
  const top = sorted[0]
  if (!top || month.totalSessions === 0) return ''

  const ratio = Math.round((top.initiateCount / month.totalSessions) * 100)
  if (ratio >= 40 && ratio <= 60) return t('views.relationship.labels.wellMatched')
  if (ratio >= 80) return t('views.relationship.labels.monologue', { name: top.name })
  return t('views.relationship.labels.missingYou', { name: top.name })
}

function getMonthInitiateRatio(month: RelationshipMonthStats): number {
  if (!memberA.value || month.totalSessions === 0) return 50
  const aStats = month.members.find((m) => m.memberId === memberA.value!.memberId)
  return Math.round(((aStats?.initiateCount ?? 0) / month.totalSessions) * 100)
}

function getMonthCloseRatio(month: RelationshipMonthStats): number {
  if (!memberA.value) return 50
  const aStats = month.members.find((m) => m.memberId === memberA.value!.memberId)
  const aClose = aStats?.closeCount ?? 0
  const totalClose = month.members.reduce((sum, m) => sum + (m.closeCount ?? 0), 0)
  if (totalClose === 0) return 50
  return Math.round((aClose / totalClose) * 100)
}

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

function getMemberResponseLatencyText(month: string, memberId?: number): string {
  if (!memberId) return '--'
  const rl = getMonthResponseLatency(month).find((r) => r.memberId === memberId)
  return rl ? formatDuration(rl.avgResponseTime) : '--'
}

function getMemberPerseveranceText(month: string, memberId?: number): string {
  if (!memberId) return '--'
  const p = getMonthPerseverance(month).find((p) => p.memberId === memberId)
  return p ? p.doubleTextCount.toString() : '--'
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return t('views.relationship.responseLatency.seconds', { n: seconds })
  if (seconds < 3600) return t('views.relationship.responseLatency.minutes', { n: Math.round(seconds / 60) })
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  if (mins === 0) return t('views.relationship.responseLatency.hours', { n: hours })
  return t('views.relationship.responseLatency.hoursMinutes', { h: hours, m: mins })
}
</script>

<template>
  <div :class="isLoading ? 'h-full' : ''">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />
    <div v-else class="main-content mx-auto max-w-[920px] space-y-6 p-6">
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
          <ThemeCard id="shareable-poster" variant="elevated" decorative class="flex flex-col">
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
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 font-black text-[10px] italic text-gray-400 shadow-inner dark:bg-gray-900/80 dark:text-gray-500"
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
                value-class="text-sm text-amber-600 dark:text-amber-400"
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
          </ThemeCard>
        </div>

        <!-- 月度时间线 -->
        <SectionCard :title="t('views.relationship.monthly.title')" :show-divider="false">
          <div class="p-6 sm:p-8">
            <div class="relative ml-4 border-l-2 border-gray-100/80 py-4 dark:border-gray-800/80">
              <div v-for="(month, idx) in stats.months" :key="month.month" class="relative pb-12 pl-10 last:pb-0">
                <!-- Timeline Dot -->
                <div
                  class="absolute -left-[11px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-4 ring-white dark:bg-gray-900 dark:ring-gray-900"
                >
                  <div
                    class="h-2.5 w-2.5 rounded-full shadow-sm"
                    :class="
                      month.totalSessions > 0
                        ? idx === 0
                          ? 'bg-pink-500 animate-pulse'
                          : 'bg-pink-400'
                        : 'bg-gray-300 dark:bg-gray-600'
                    "
                  />
                </div>

                <!-- Month Content Card -->
                <div
                  class="group relative overflow-hidden rounded-[20px] bg-card-bg shadow-sm ring-1 ring-gray-900/5 transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-card-dark dark:ring-white/10"
                >
                  <!-- 装饰背景 -->
                  <div
                    v-if="month.totalSessions > 0"
                    class="pointer-events-none absolute inset-0 overflow-hidden opacity-30 transition-opacity group-hover:opacity-50"
                  >
                    <div
                      class="absolute -left-[10%] top-[20%] h-[60%] w-[40%] rounded-full bg-blue-400/10 blur-[40px] dark:bg-blue-500/20"
                    />
                    <div
                      class="absolute -right-[10%] bottom-[20%] h-[60%] w-[40%] rounded-full bg-pink-400/10 blur-[40px] dark:bg-pink-500/20"
                    />
                  </div>

                  <div class="relative z-10 p-4 sm:p-5">
                    <!-- 头部：月份与总次数 -->
                    <div class="flex items-center justify-between" :class="month.totalSessions > 0 ? 'mb-4' : ''">
                      <div class="flex items-center gap-3">
                        <span class="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                          {{ formatMonth(month.month) }}
                        </span>
                        <span
                          class="rounded-lg px-2.5 py-1 text-xs font-semibold"
                          :class="
                            month.totalSessions === 0
                              ? 'bg-gray-50 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400'
                              : 'bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400'
                          "
                        >
                          {{ getMonthLabel(month) }}
                        </span>
                      </div>

                      <div v-if="month.totalSessions > 0" class="flex items-baseline gap-1.5">
                        <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {{ t('views.relationship.monthly.totalSessionsPrefix') }}
                        </span>
                        <span class="text-2xl font-black leading-none text-gray-900 dark:text-white">
                          {{ month.totalSessions }}
                        </span>
                        <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {{ t('views.relationship.monthly.totalSessionsSuffix') }}
                        </span>
                      </div>
                    </div>

                    <template v-if="month.totalSessions > 0">
                      <!-- 内容区：四列高度压缩卡片网格 -->
                      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <!-- 1. 发起者 -->
                        <div
                          class="flex flex-col rounded-xl bg-blue-50/50 p-3 ring-1 ring-blue-100/50 dark:bg-blue-500/5 dark:ring-blue-500/10"
                        >
                          <div class="mb-2.5 flex items-center gap-1.5">
                            <UIcon
                              name="i-heroicons-chat-bubble-bottom-center-text-solid"
                              class="h-3.5 w-3.5 text-blue-500 dark:text-blue-400"
                            />
                            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {{ t('views.relationship.initiator') }}
                            </span>
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberA?.name }}
                              </span>
                              <span class="font-black tabular-nums text-blue-600 dark:text-blue-400">
                                {{ month.members.find((m) => m.memberId === memberA?.memberId)?.initiateCount ?? 0 }}
                              </span>
                            </div>
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberB?.name }}
                              </span>
                              <span class="font-black tabular-nums text-pink-500 dark:text-pink-400">
                                {{ month.members.find((m) => m.memberId === memberB?.memberId)?.initiateCount ?? 0 }}
                              </span>
                            </div>
                          </div>
                          <div class="mt-3 flex h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                              class="bg-blue-500 dark:bg-blue-400"
                              :style="{ width: clampBarWidth(getMonthInitiateRatio(month)) + '%' }"
                            />
                            <div
                              class="bg-pink-500 dark:bg-pink-400"
                              :style="{ width: clampBarWidth(100 - getMonthInitiateRatio(month)) + '%' }"
                            />
                          </div>
                        </div>

                        <!-- 2. 终结者 -->
                        <div
                          class="flex flex-col rounded-xl bg-indigo-50/50 p-3 ring-1 ring-indigo-100/50 dark:bg-indigo-500/5 dark:ring-indigo-500/10"
                        >
                          <div class="mb-2.5 flex items-center gap-1.5">
                            <UIcon
                              name="i-heroicons-hand-raised-solid"
                              class="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400"
                            />
                            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {{ t('views.relationship.closer') }}
                            </span>
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberA?.name }}
                              </span>
                              <span class="font-black tabular-nums text-indigo-600 dark:text-indigo-400">
                                {{ month.members.find((m) => m.memberId === memberA?.memberId)?.closeCount ?? 0 }}
                              </span>
                            </div>
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberB?.name }}
                              </span>
                              <span class="font-black tabular-nums text-pink-500 dark:text-pink-400">
                                {{ month.members.find((m) => m.memberId === memberB?.memberId)?.closeCount ?? 0 }}
                              </span>
                            </div>
                          </div>
                          <div class="mt-3 flex h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                              class="bg-indigo-500 dark:bg-indigo-400"
                              :style="{ width: clampBarWidth(getMonthCloseRatio(month)) + '%' }"
                            />
                            <div
                              class="bg-pink-500 dark:bg-pink-400"
                              :style="{ width: clampBarWidth(100 - getMonthCloseRatio(month)) + '%' }"
                            />
                          </div>
                        </div>

                        <!-- 3. 响应时延 -->
                        <div
                          class="flex flex-col rounded-xl bg-amber-50/50 p-3 ring-1 ring-amber-100/50 dark:bg-amber-500/5 dark:ring-amber-500/10"
                        >
                          <div class="mb-2.5 flex items-center gap-1.5">
                            <UIcon
                              name="i-heroicons-clock-solid"
                              class="h-3.5 w-3.5 text-amber-500 dark:text-amber-400"
                            />
                            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {{ t('views.relationship.responseLatency.title') }}
                            </span>
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberA?.name }}
                              </span>
                              <span class="font-black tabular-nums text-amber-600 dark:text-amber-500">
                                {{ getMemberResponseLatencyText(month.month, memberA?.memberId) }}
                              </span>
                            </div>
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberB?.name }}
                              </span>
                              <span class="font-black tabular-nums text-amber-600 dark:text-amber-500">
                                {{ getMemberResponseLatencyText(month.month, memberB?.memberId) }}
                              </span>
                            </div>
                          </div>
                        </div>

                        <!-- 4. 锲而不舍 -->
                        <div
                          class="flex flex-col rounded-xl bg-purple-50/50 p-3 ring-1 ring-purple-100/50 dark:bg-purple-500/5 dark:ring-purple-500/10"
                        >
                          <div class="mb-2.5 flex items-center gap-1.5">
                            <UIcon
                              name="i-heroicons-arrow-path-solid"
                              class="h-3.5 w-3.5 text-purple-500 dark:text-purple-400"
                            />
                            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {{ t('views.relationship.perseverance.title') }}
                            </span>
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberA?.name }}
                              </span>
                              <span class="font-black tabular-nums text-purple-600 dark:text-purple-400">
                                {{ getMemberPerseveranceText(month.month, memberA?.memberId) }}
                              </span>
                            </div>
                            <div class="flex items-center justify-between text-xs">
                              <span class="w-12 truncate font-medium text-gray-500 dark:text-gray-400">
                                {{ memberB?.name }}
                              </span>
                              <span class="font-black tabular-nums text-purple-600 dark:text-purple-400">
                                {{ getMemberPerseveranceText(month.month, memberB?.memberId) }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </template>

                    <div
                      v-else
                      class="flex h-24 items-center justify-center text-sm font-medium text-gray-400 dark:text-gray-500"
                    >
                      {{ t('views.relationship.noActivity') }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </template>
    </div>
  </div>
</template>
