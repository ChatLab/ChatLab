<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ChatType, type TimeInvestmentResponse } from '@openchatlab/shared-types'
import { useLayoutStore } from '@/stores/layout'
import type { AnnualSummaryFetchOptions } from '@/services/data/types'
import { useDataService } from '@/services'
import { reportError } from '@/services/log-report'
import { formatDateRange } from '@/utils'
import LoadingState from '@/components/UI/LoadingState.vue'
import { CardDecoration, ThemeCard } from '@/components/UI'
import { EChartLine } from '@/components/charts'
import { PLATFORM_CAPABILITIES } from '@/utils/platform-capabilities'
import { useInsightTimeRange, watchInsightSettingsClose } from '../insight-time-range'

const { t, locale } = useI18n()
const layoutStore = useLayoutStore()
const { showSettings } = storeToRefs(layoutStore)
const currentYear = new Date().getFullYear()
const timeRange = useInsightTimeRange()
const response = ref<TimeInvestmentResponse | null>(null)
const errorMessage = ref('')
let pollTimer: ReturnType<typeof setTimeout> | null = null
let requestToken = 0

const requestOptions = computed<AnnualSummaryFetchOptions | null>(() => {
  const state = timeRange.modelValue.value?.state
  if (!state) return null
  return state.mode === 'recent'
    ? { mode: 'recent', days: 365, acceptStale: true }
    : { mode: 'year', year: state.year ?? currentYear, acceptStale: true }
})
const requestKey = computed(() => JSON.stringify(requestOptions.value))
const ownerIssueCount = computed(
  () => (response.value?.coverage.missingOwnerSessions ?? 0) + (response.value?.coverage.unresolvedOwnerSessions ?? 0)
)
const hasSnapshot = computed(() => response.value?.metrics !== null && response.value?.metrics !== undefined)
const isUpdating = computed(() => response.value?.task.status === 'running')
const isZeroData = computed(() => hasSnapshot.value && response.value?.metrics?.estimatedSeconds === 0)
const hasNoAnalyzableOwner = computed(
  () =>
    (response.value?.coverage.totalSessions ?? 0) > 0 &&
    response.value?.coverage.analyzedSessions === 0 &&
    ownerIssueCount.value > 0
)
const canConfigureOwner = !PLATFORM_CAPABILITIES.usesBrowserRuntime
const selectedYear = computed(() =>
  timeRange.modelValue.value?.state.mode === 'year' ? timeRange.modelValue.value.state.year : undefined
)
const latestYearSuggestion = computed(() => {
  const year = selectedYear.value
  const latestYear = response.value?.latestDataYear
  if (year === undefined || latestYear === null || latestYear === undefined || year === latestYear) return null
  return { year, latestYear }
})
const title = computed(() =>
  response.value?.range.mode === 'year'
    ? t('insight.timeInvestment.yearTitle', { year: response.value.range.year })
    : t('insight.timeInvestment.recentTitle')
)
const timeRangeText = computed(() => {
  const range = response.value?.range
  return range ? formatDateRange(range.startTs, range.endTs, 'YYYY/MM/DD') : ''
})
const monthlyChartData = computed(() => {
  const range = response.value?.range
  const data = response.value?.monthlyActivity ?? []
  return {
    labels: data.map((item) =>
      range?.mode === 'year'
        ? t('insight.monthLabel', { month: Number(item.key.slice(5)) })
        : item.key.replace('-', '/')
    ),
    values: data.map((item) => secondsToHours(item.estimatedSeconds)),
  }
})
const weekdayInvestmentItems = computed(() => {
  const range = response.value?.range
  if (!range) return []
  const totals = Array<number>(7).fill(0)
  const dayCounts = Array<number>(7).fill(0)
  const dailyInvestment = new Map(
    (response.value?.dailyActivity ?? []).map((item) => [item.key, item.estimatedSeconds])
  )
  const cursor = startOfLocalDay(new Date(range.startTs * 1000))
  const end = startOfLocalDay(new Date(range.endTs * 1000))
  while (cursor <= end) {
    const weekdayIndex = (cursor.getDay() + 6) % 7
    totals[weekdayIndex] += dailyInvestment.get(formatLocalDate(cursor)) ?? 0
    dayCounts[weekdayIndex]++
    cursor.setDate(cursor.getDate() + 1)
  }
  const averages = totals.map((total, index) => (dayCounts[index] ? Math.round(total / dayCounts[index]) : 0))
  const maxAverage = Math.max(...averages, 1)
  const weekdayFormatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })

  return averages.map((seconds, index) => ({
    key: index,
    label: weekdayFormatter.format(new Date(2024, 0, 1 + index)),
    seconds,
    width: seconds > 0 ? Math.max((seconds / maxAverage) * 100, 3) : 0,
  }))
})
const hasWeekdayInvestment = computed(() => weekdayInvestmentItems.value.some((item) => item.seconds > 0))
const topInvestmentDays = computed(() => {
  const weekdayFormatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  const dateFormatter = new Intl.DateTimeFormat(locale.value, { month: '2-digit', day: '2-digit' })
  return [...(response.value?.dailyActivity ?? [])]
    .filter((item) => item.estimatedSeconds > 0)
    .sort((a, b) => b.estimatedSeconds - a.estimatedSeconds || a.key.localeCompare(b.key))
    .slice(0, 3)
    .map((item) => {
      const date = parseLocalDate(item.key)
      return {
        ...item,
        dateLabel: dateFormatter.format(date),
        weekdayLabel: weekdayFormatter.format(date),
      }
    })
})
const chatTypeComparisonItems = computed(() =>
  [ChatType.GROUP, ChatType.PRIVATE]
    .map((type) => response.value?.chatTypes.find((item) => item.type === type))
    .filter((item) => item !== undefined)
)
const investmentDetailStats = computed(() => {
  const privateItem = chatTypeComparisonItems.value.find((item) => item.type === ChatType.PRIVATE)
  const groupItem = chatTypeComparisonItems.value.find((item) => item.type === ChatType.GROUP)
  const peakDay = topInvestmentDays.value[0]
  const peakWeekday = [...weekdayInvestmentItems.value].sort((a, b) => b.seconds - a.seconds)[0]

  return [
    {
      key: 'private',
      icon: 'i-heroicons-user',
      colorClass: 'text-pink-600 dark:text-pink-400',
      label: t('insight.timeInvestment.privateChat'),
      value: privateItem ? formatDuration(privateItem.seconds) : '—',
      subtext: t('insight.timeInvestment.shareOfTotal', { share: privateItem?.share ?? 0 }),
    },
    {
      key: 'group',
      icon: 'i-heroicons-user-group',
      colorClass: 'text-blue-600 dark:text-blue-400',
      label: t('insight.timeInvestment.groupChat'),
      value: groupItem ? formatDuration(groupItem.seconds) : '—',
      subtext: t('insight.timeInvestment.shareOfTotal', { share: groupItem?.share ?? 0 }),
    },
    {
      key: 'peakDay',
      icon: 'i-heroicons-fire',
      colorClass: 'text-red-600 dark:text-red-400',
      label: t('insight.timeInvestment.peakDay'),
      value: peakDay?.dateLabel ?? '—',
      subtext: peakDay ? formatDuration(peakDay.estimatedSeconds) : '—',
    },
    {
      key: 'peakWeekday',
      icon: 'i-heroicons-calendar-days',
      colorClass: 'text-amber-600 dark:text-amber-400',
      label: t('insight.timeInvestment.peakWeekday'),
      value: peakWeekday?.seconds ? peakWeekday.label : '—',
      subtext: peakWeekday?.seconds ? formatDuration(peakWeekday.seconds) : '—',
    },
  ]
})
const sessionRankingsByType = computed(() =>
  [ChatType.PRIVATE, ChatType.GROUP].map((type) => {
    const items = (response.value?.sessionRanking ?? [])
      .filter((item) => item.type === type)
      .slice(0, 10)
      .map((item, index) => ({ ...item, rank: index + 1 }))
    return {
      type,
      items,
      maxSeconds: Math.max(...items.map((item) => item.seconds), 1),
    }
  })
)
const hasRankedSessions = computed(() => sessionRankingsByType.value.some((ranking) => ranking.items.length > 0))

watch(
  requestKey,
  () => {
    clearPoll()
    if (!requestOptions.value) return
    response.value = null
    void loadTimeInvestment(false)
  },
  { immediate: true }
)
watchInsightSettingsClose(showSettings, () => void loadTimeInvestment(false))
onBeforeUnmount(clearPoll)

async function loadTimeInvestment(recompute: boolean): Promise<void> {
  const options = requestOptions.value
  if (!options) return
  const token = ++requestToken
  errorMessage.value = ''
  try {
    const result = recompute
      ? await useDataService().recomputeTimeInvestment(options)
      : await useDataService().getTimeInvestment(options)
    if (token !== requestToken) return
    response.value = result
    if (result.metrics) timeRange.setAvailableYears(result.availableDataYears)
    if (result.task.status === 'running') schedulePoll()
  } catch (error) {
    if (token !== requestToken) return
    const message = error instanceof Error ? error.message : String(error)
    errorMessage.value = message
    reportError(`Global insight time investment failed: ${message}`, error instanceof Error ? error.stack : undefined)
  }
}

function schedulePoll(): void {
  clearPoll()
  pollTimer = setTimeout(() => void loadTimeInvestment(false), 900)
}

function clearPoll(): void {
  if (!pollTimer) return
  clearTimeout(pollTimer)
  pollTimer = null
}

function switchToLatestYear(): void {
  const year = response.value?.latestDataYear
  if (year) timeRange.switchToYear(year)
}

function openSessions(): void {
  layoutStore.openSettings('data', 'missing-owner')
}

function formatDuration(seconds: number): string {
  const roundedMinutes = Math.round(seconds / 60)
  if (seconds > 0 && roundedMinutes < 1) return t('insight.timeInvestment.duration.lessThanMinute')
  if (roundedMinutes < 60) return t('insight.timeInvestment.duration.minutes', { count: roundedMinutes })
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60
  return minutes
    ? t('insight.timeInvestment.duration.hoursMinutes', { hours, minutes })
    : t('insight.timeInvestment.duration.hours', { count: hours })
}

function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function chatTypeLabel(type: ChatType): string {
  return t(type === ChatType.PRIVATE ? 'insight.timeInvestment.privateChat' : 'insight.timeInvestment.groupChat')
}
</script>

<template>
  <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-[920px] space-y-6 px-4 py-5 sm:px-6 sm:py-6">
      <button
        v-if="ownerIssueCount > 0 && canConfigureOwner"
        type="button"
        class="inline-flex w-fit max-w-full items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/30"
        @click="openSessions"
      >
        <UIcon name="i-heroicons-user-circle" class="h-4 w-4 shrink-0" />
        <span class="min-w-0">{{ t('insight.status.ownerIssues', { count: ownerIssueCount }) }}</span>
        <UIcon name="i-heroicons-arrow-right" class="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>

      <div
        v-if="response?.cache.status === 'stale' || (isUpdating && hasSnapshot)"
        class="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-950/40 dark:bg-amber-950/20 dark:text-amber-300"
      >
        <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 shrink-0 animate-spin" />
        {{ t('insight.status.updating') }}
      </div>

      <div
        v-if="errorMessage || response?.task.status === 'failed'"
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/50 px-4 py-2.5 text-xs text-red-800 dark:border-red-950/40 dark:bg-red-950/20 dark:text-red-300"
      >
        <span>{{ t('insight.timeInvestment.failed') }}</span>
        <UButton size="xs" color="error" variant="soft" icon="i-heroicons-arrow-path" @click="loadTimeInvestment(true)">
          {{ t('insight.actions.retry') }}
        </UButton>
      </div>

      <LoadingState
        v-if="!hasSnapshot && !errorMessage && response?.task.status !== 'failed'"
        height="min(52vh, 420px)"
        :text="
          response?.task.status === 'running'
            ? t('insight.status.computingProgress', {
                processed: response.task.processedSessions,
                total: response.task.totalSessions,
              })
            : t('insight.timeInvestment.loading')
        "
      />

      <template v-else-if="response?.metrics">
        <div
          v-if="isZeroData"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300"
        >
          <span v-if="hasNoAnalyzableOwner">{{ t('insight.status.noAnalyzableOwner') }}</span>
          <span v-else-if="latestYearSuggestion">{{ t('insight.status.noDataWithLatest', latestYearSuggestion) }}</span>
          <span v-else>{{ t('insight.noData') }}</span>
          <UButton
            v-if="latestYearSuggestion"
            size="xs"
            variant="soft"
            color="neutral"
            icon="i-heroicons-arrow-right"
            @click="switchToLatestYear"
          >
            {{ t('insight.actions.switchYear', { year: latestYearSuggestion.latestYear }) }}
          </UButton>
        </div>

        <div class="space-y-4">
          <ThemeCard class="relative isolate overflow-hidden">
            <CardDecoration />
            <section class="relative z-10 min-w-0 px-5 pt-6 pb-5 sm:px-8 sm:pt-8 sm:pb-6">
              <h2 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">{{ title }}</h2>

              <div class="mt-6 max-w-3xl space-y-3 text-gray-600 dark:text-zinc-300">
                <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg leading-relaxed sm:text-xl">
                  <span>{{ t('insight.timeInvestment.narrative.totalPrefix') }}</span>
                  <span
                    class="font-black text-2xl tracking-tight tabular-nums text-pink-600 sm:text-3xl dark:text-pink-400"
                  >
                    {{ formatDuration(response.metrics.estimatedSeconds) }}
                  </span>
                  <span>{{ t('insight.timeInvestment.narrative.totalSuffix') }}</span>
                </p>

                <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base leading-relaxed sm:text-lg">
                  <span>{{ t('insight.timeInvestment.narrative.daysPrefix') }}</span>
                  <span class="font-black text-2xl tabular-nums text-indigo-600 dark:text-indigo-400">
                    {{ response.metrics.activeDayCount.toLocaleString() }}
                  </span>
                  <span>{{ t('insight.timeInvestment.narrative.daysMiddle') }}</span>
                  <span class="font-black text-2xl tabular-nums text-blue-600 dark:text-blue-400">
                    {{ formatDuration(response.metrics.averagePerActiveDaySeconds) }}
                  </span>
                  <span>{{ t('insight.timeInvestment.narrative.daysSuffix') }}</span>
                </p>
              </div>

              <div class="mt-7">
                <div class="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500">
                  {{ t('insight.overviewCard.keyMetrics') }}
                </div>
                <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div
                    v-for="stat in investmentDetailStats"
                    :key="stat.key"
                    class="flex min-w-0 items-start gap-2 px-2.5 py-2"
                  >
                    <UIcon :name="stat.icon" class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="stat.colorClass" />
                    <div class="min-w-0">
                      <div
                        class="truncate font-mono text-sm leading-tight font-black tabular-nums"
                        :class="stat.colorClass"
                      >
                        {{ stat.value }}
                      </div>
                      <div class="mt-0.5 truncate text-[10px] font-medium text-gray-500 dark:text-zinc-400">
                        {{ stat.label }}
                      </div>
                      <div class="mt-0.5 truncate text-[9px] text-gray-400 dark:text-zinc-500">
                        {{ stat.subtext }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="mt-6">
                <div>
                  <h3 class="text-xs font-bold tracking-wide text-gray-700 dark:text-zinc-300">
                    {{ t('insight.timeInvestment.monthlyTitle') }}
                  </h3>
                  <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
                    {{ t('insight.timeInvestment.monthlyDescription') }}
                  </p>
                </div>
                <div class="mt-2">
                  <EChartLine
                    :data="monthlyChartData"
                    :height="240"
                    mode="compact"
                    :smooth="false"
                    :show-area="false"
                  />
                </div>
                <p class="mt-2 text-[10px] leading-5 text-gray-400 dark:text-zinc-500">
                  {{ t('insight.timeInvestment.estimateNote') }}
                </p>
              </div>

              <div
                class="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-gray-200/60 pt-4 font-mono text-[10px] text-gray-400 dark:border-white/5 dark:text-zinc-500"
              >
                <span>{{ timeRangeText }}</span>
                <span>
                  {{
                    t('insight.status.coverage', {
                      analyzed: response.coverage.analyzedSessions,
                      total: response.coverage.totalSessions,
                    })
                  }}
                </span>
              </div>
            </section>
          </ThemeCard>

          <ThemeCard>
            <section class="min-w-0 p-5 sm:p-6">
              <h3
                class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300"
              >
                <span class="inline-block h-2 w-2 rounded-full bg-pink-500 dark:bg-pink-400" />
                {{ t('insight.timeInvestment.rhythmTitle') }}
              </h3>
              <p class="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
                {{ t('insight.timeInvestment.rhythmDescription') }}
              </p>

              <div class="mt-5 grid gap-6 lg:grid-cols-7 lg:gap-0">
                <div class="min-w-0 lg:col-span-4 lg:pr-8">
                  <div v-if="hasWeekdayInvestment" class="space-y-3.5">
                    <div
                      v-for="item in weekdayInvestmentItems"
                      :key="item.key"
                      class="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3"
                    >
                      <span class="text-xs font-medium text-gray-500 dark:text-zinc-400">{{ item.label }}</span>
                      <div class="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
                        <div
                          class="h-full rounded-full bg-pink-500 transition-[width] duration-500 dark:bg-pink-400"
                          :style="{ width: `${item.width}%` }"
                        />
                      </div>
                      <span
                        class="min-w-[4.75rem] whitespace-nowrap text-right font-mono text-[10px] font-semibold tabular-nums text-gray-600 dark:text-zinc-300"
                      >
                        {{ formatDuration(item.seconds) }}
                      </span>
                    </div>
                  </div>
                  <p v-else class="text-xs text-gray-400">{{ t('insight.noData') }}</p>
                </div>

                <div
                  class="min-w-0 border-t border-gray-200/60 pt-5 lg:col-span-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 dark:border-white/5"
                >
                  <h4 class="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                    {{ t('insight.timeInvestment.topDaysTitle') }}
                  </h4>
                  <div v-if="topInvestmentDays.length" class="mt-3 divide-y divide-gray-200/60 dark:divide-white/5">
                    <div
                      v-for="(item, index) in topInvestmentDays"
                      :key="item.key"
                      class="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span
                        class="flex h-5 w-5 items-center justify-center rounded-full bg-pink-50 font-mono text-[9px] font-bold text-pink-600 dark:bg-pink-950/30 dark:text-pink-400"
                      >
                        {{ index + 1 }}
                      </span>
                      <div class="flex min-w-0 items-baseline gap-2">
                        <span class="font-mono text-xs font-semibold tabular-nums text-gray-700 dark:text-zinc-200">
                          {{ item.dateLabel }}
                        </span>
                        <span class="truncate text-[10px] text-gray-400 dark:text-zinc-500">
                          {{ item.weekdayLabel }}
                        </span>
                      </div>
                      <span
                        class="whitespace-nowrap font-mono text-[10px] font-semibold tabular-nums text-gray-600 dark:text-zinc-300"
                      >
                        {{ formatDuration(item.estimatedSeconds) }}
                      </span>
                    </div>
                  </div>
                  <p v-else class="mt-3 text-xs text-gray-400">{{ t('insight.noData') }}</p>
                </div>
              </div>
            </section>
          </ThemeCard>

          <ThemeCard>
            <section class="min-w-0 p-5 sm:p-6">
              <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div>
                  <h3 class="text-base font-semibold text-gray-800 dark:text-zinc-200">
                    {{ t('insight.timeInvestment.rankingTitle') }}
                  </h3>
                  <p class="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
                    {{ t('insight.timeInvestment.rankingDescription') }}
                  </p>
                </div>
              </div>

              <div
                v-if="hasRankedSessions"
                class="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-gray-200/60 dark:lg:divide-white/5"
              >
                <div
                  v-for="ranking in sessionRankingsByType"
                  :key="ranking.type"
                  class="min-w-0 lg:px-10 lg:first:pl-0 lg:last:pr-0"
                >
                  <div
                    class="flex items-center justify-between gap-4 border-b border-gray-200/60 pb-3 dark:border-white/5"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <span
                        class="h-2.5 w-2.5 shrink-0 rounded-full"
                        :class="
                          ranking.type === ChatType.PRIVATE
                            ? 'bg-pink-500 dark:bg-pink-400'
                            : 'bg-blue-500 dark:bg-blue-400'
                        "
                      />
                      <h4 class="truncate text-sm font-semibold text-gray-700 dark:text-zinc-200">
                        {{ chatTypeLabel(ranking.type) }}
                      </h4>
                    </div>
                    <span class="shrink-0 text-[10px] text-gray-400 dark:text-zinc-500">
                      {{ t('insight.timeInvestment.rankingCount', { count: ranking.items.length }) }}
                    </span>
                  </div>

                  <div v-if="ranking.items.length" class="divide-y divide-gray-200/60 dark:divide-white/5">
                    <div v-for="item in ranking.items" :key="item.sessionId" class="min-w-0 py-3 last:pb-0">
                      <div class="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3">
                        <span
                          class="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                          :class="
                            item.rank <= 3
                              ? ranking.type === ChatType.PRIVATE
                                ? 'bg-pink-50 text-pink-600 dark:bg-pink-950/30 dark:text-pink-400'
                                : 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400'
                          "
                        >
                          {{ item.rank }}
                        </span>
                        <div class="min-w-0">
                          <span class="block truncate text-sm font-semibold text-gray-700 dark:text-zinc-200">
                            {{ item.name }}
                          </span>
                          <span class="mt-1 block truncate text-[10px] text-gray-400 dark:text-zinc-500">
                            {{ item.platform }}
                          </span>
                        </div>
                        <div class="shrink-0 text-right">
                          <div
                            class="whitespace-nowrap font-mono text-xs font-black tabular-nums text-gray-900 dark:text-white"
                          >
                            {{ formatDuration(item.seconds) }}
                          </div>
                          <div class="mt-1 font-mono text-[10px] tabular-nums text-gray-400 dark:text-zinc-500">
                            {{ item.share }}%
                          </div>
                        </div>
                      </div>
                      <div class="mt-2 ml-10 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
                        <div
                          class="h-full rounded-full"
                          :class="
                            ranking.type === ChatType.PRIVATE
                              ? 'bg-pink-500 dark:bg-pink-400'
                              : 'bg-blue-500 dark:bg-blue-400'
                          "
                          :style="{ width: `${(item.seconds / ranking.maxSeconds) * 100}%` }"
                        />
                      </div>
                    </div>
                  </div>
                  <p v-else class="pt-4 text-xs text-gray-400">{{ t('insight.noData') }}</p>
                </div>
              </div>
              <p v-else class="mt-5 text-xs text-gray-400">{{ t('insight.noData') }}</p>
            </section>
          </ThemeCard>
        </div>
      </template>
    </div>
  </main>
</template>
