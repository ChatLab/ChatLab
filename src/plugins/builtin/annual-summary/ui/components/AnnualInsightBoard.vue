<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  AnnualSummaryCoverage,
  AnnualSummaryMetrics,
  AnnualSummaryRange,
  AnnualSummaryTextLength,
} from '@openchatlab/shared-types'
import { MessageType, getMessageTypeName } from '@/types/base'
import { CardDecoration, ThemeCard } from '@/components/UI'
import type { AnnualSummaryTranslate } from '../../locales'
import { deriveAnnualActivityRhythm } from '../../domain/activity-rhythm'
import InsightCalendarGrid from './InsightCalendarGrid.vue'
import AnnualMonthlyTrend from './AnnualMonthlyTrend.vue'

const props = defineProps<{
  t: AnnualSummaryTranslate
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  range: AnnualSummaryRange
  metrics: AnnualSummaryMetrics
  coverage: AnnualSummaryCoverage
  monthlyActivity: Array<{ month: string; messageCount: number }>
  monthlyDirectContacts: Array<{ month: string; contactCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: AnnualSummaryTextLength
}>()

const t = props.t
const monthlyTrendMode = ref<'messages' | 'contacts'>('messages')

const title = computed(() =>
  props.range.mode === 'year'
    ? props.t('overview.yearTitle', { year: props.range.year })
    : props.t('overview.recentTitle')
)
const timeRangeText = computed(() => {
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' } as const
  return `${props.formatDate(props.range.startTs * 1000, options)} – ${props.formatDate(props.range.endTs * 1000, options)}`
})
const peakMonth = computed(() =>
  props.monthlyActivity.reduce<(typeof props.monthlyActivity)[number] | null>(
    (peak, item) => (!peak || item.messageCount > peak.messageCount ? item : peak),
    null
  )
)
const peakDay = computed(() =>
  props.dailyActivity.reduce<(typeof props.dailyActivity)[number] | null>(
    (peak, item) => (!peak || item.messageCount > peak.messageCount ? item : peak),
    null
  )
)
const sortedMessageTypes = computed(() => [...props.messageTypes].sort((a, b) => b.count - a.count).slice(0, 6))
const messageTypeTotal = computed(() => props.messageTypes.reduce((sum, item) => sum + item.count, 0))
const textMessageCount = computed(() => props.messageTypes.find((item) => item.type === MessageType.TEXT)?.count ?? 0)
const textMessageRatio = computed(() => percentage(textMessageCount.value, messageTypeTotal.value))
const maxLengthBucket = computed(() => Math.max(...props.textLength.buckets.map((item) => item.count), 1))
const activeRate = computed(() => {
  const days = Math.max(1, Math.round((props.range.endTs - props.range.startTs) / 86400) + 1)
  return percentage(props.metrics.activeDayCount, days)
})
const activityRhythm = computed(() => deriveAnnualActivityRhythm(props.dailyActivity))
const detailStats = computed(() => [
  {
    key: 'dailyContacts',
    value: formatValue(props.metrics.averageDirectContactsPerDay),
    label: props.t('overview.dailyContacts'),
    subtext: props.t('overview.perDay'),
    icon: 'i-heroicons-user-plus',
    colorClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    key: 'peakMonth',
    value: formatMonth(peakMonth.value?.month),
    label: props.t('overview.peakMonth'),
    subtext: props.t('overview.messagesCount', { count: formatValue(peakMonth.value?.messageCount ?? 0) }),
    icon: 'i-heroicons-calendar-days',
    colorClass: 'text-pink-600 dark:text-pink-400',
  },
  {
    key: 'peakDay',
    value: formatDay(peakDay.value?.date),
    label: props.t('overview.peakDay'),
    subtext: props.t('overview.messagesCount', { count: formatValue(peakDay.value?.messageCount ?? 0) }),
    icon: 'i-heroicons-fire',
    colorClass: 'text-red-600 dark:text-red-400',
  },
  {
    key: 'longestActiveStreak',
    value: formatValue(activityRhythm.value.longestActiveStreak),
    label: props.t('overview.longestActiveStreak'),
    subtext: props.t('overview.consecutiveActiveDays'),
    icon: 'i-heroicons-bolt',
    colorClass: 'text-amber-600 dark:text-amber-400',
  },
])
const monthlyTrendData = computed(() =>
  monthlyTrendMode.value === 'messages'
    ? props.monthlyActivity.map((item) => ({ month: item.month, value: item.messageCount }))
    : props.monthlyDirectContacts.map((item) => ({ month: item.month, value: item.contactCount }))
)
const calendarData = computed(() => props.dailyActivity.map((item) => ({ date: item.date, value: item.messageCount })))
const monthlyTrendDescription = computed(() =>
  props.t(monthlyTrendMode.value === 'messages' ? 'sections.overviewDescription' : 'sections.directContactsDescription')
)
function formatValue(value: number): string {
  return props.formatNumber(value, Number.isInteger(value) ? undefined : { maximumFractionDigits: 1 })
}

function formatMonth(month: string | undefined): string {
  if (!month) return '-'
  return props.range.mode === 'year'
    ? props.t('monthLabel', { month: Number(month.slice(5)) })
    : month.replace('-', '/')
}

function formatDay(date: string | undefined): string {
  if (!date) return '-'
  const [year, month, day] = date.split('-')
  return props.formatDate(new Date(Number(year), Number(month) - 1, Number(day)), {
    day: '2-digit',
    month: '2-digit',
  })
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function translateCommon(key: string): string {
  return t(key as `common.${string}`)
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-7">
    <ThemeCard class="relative isolate overflow-hidden xl:col-span-7">
      <CardDecoration />
      <section class="relative z-10 min-w-0 px-5 pt-6 pb-5 sm:px-8 sm:pt-8 sm:pb-6">
        <h2 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">{{ title }}</h2>

        <div class="mt-6">
          <div class="max-w-3xl space-y-3 text-gray-600 dark:text-zinc-300">
            <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-lg leading-relaxed sm:text-xl">
              <span>{{ t('overview.narrative.messagesPrefix') }}</span>
              <span
                class="font-black text-2xl tracking-tight tabular-nums text-pink-600 sm:text-3xl dark:text-pink-400"
              >
                {{ formatValue(metrics.sentMessageCount) }}
              </span>
              <span>{{ t('overview.narrative.messagesSuffix') }}</span>
              <span class="font-black text-2xl tabular-nums text-blue-600 sm:text-3xl dark:text-blue-400">
                {{ formatValue(metrics.averageMessagesPerDay) }}
              </span>
              <span>{{ t('overview.narrative.dailySuffix') }}</span>
            </p>

            <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base leading-relaxed sm:text-lg">
              <span>{{ t('overview.narrative.activePrefix') }}</span>
              <span class="font-black text-2xl tabular-nums text-indigo-600 dark:text-indigo-400">
                {{ formatValue(metrics.activeDayCount) }}
              </span>
              <span>{{ t('overview.narrative.activeMiddle') }}</span>
              <span class="font-black text-2xl tabular-nums text-amber-600 dark:text-amber-400">
                {{ formatValue(metrics.directContactCount) }}
              </span>
              <span>{{ t('overview.narrative.contactsSuffix') }}</span>
            </p>
          </div>

          <div class="mt-7">
            <div class="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500">
              {{ t('overview.keyMetrics') }}
            </div>
            <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div v-for="stat in detailStats" :key="stat.key" class="flex min-w-0 items-start gap-2 px-2.5 py-2">
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

          <div class="mt-6 w-full min-w-0">
            <div class="mb-1 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-xs font-bold tracking-wide text-gray-700 dark:text-zinc-300">
                  {{ t('sections.overview') }}
                </h3>
                <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">{{ monthlyTrendDescription }}</p>
              </div>
              <div class="flex rounded-lg bg-gray-100 p-0.5 dark:bg-zinc-800">
                <button
                  v-for="mode in ['messages', 'contacts'] as const"
                  :key="mode"
                  type="button"
                  class="rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors"
                  :class="
                    monthlyTrendMode === mode
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                      : 'text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                  "
                  :aria-pressed="monthlyTrendMode === mode"
                  @click="monthlyTrendMode = mode"
                >
                  {{ t(`overview.monthlyTrend.${mode}`) }}
                </button>
              </div>
            </div>
            <AnnualMonthlyTrend :t="t" :range="range" :data="monthlyTrendData" :height="240" />
          </div>
        </div>

        <div
          class="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-gray-200/60 pt-4 font-mono text-[10px] text-gray-400 dark:border-white/5 dark:text-zinc-500"
        >
          <span>{{ timeRangeText }}</span>
          <span>
            {{
              t('status.coverage', {
                analyzed: coverage.analyzedSessions,
                total: coverage.totalSessions,
              })
            }}
          </span>
        </div>
      </section>
    </ThemeCard>

    <div class="grid min-w-0 gap-4 xl:col-span-4">
      <ThemeCard>
        <section class="min-w-0 p-5 sm:p-6">
          <h3
            class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300"
          >
            <span class="inline-block h-2 w-2 rounded-full bg-pink-500 dark:bg-pink-400" />
            {{ t('sections.messageTypes') }}
          </h3>
          <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
            {{ t('sections.messageTypesDescription') }}
          </p>
          <div v-if="sortedMessageTypes.length" class="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
            <div v-for="item in sortedMessageTypes" :key="item.type" class="min-w-0">
              <div class="flex items-end justify-between gap-2">
                <span class="truncate text-xs font-medium text-gray-600 dark:text-zinc-300">
                  {{ getMessageTypeName(item.type, translateCommon) }}
                </span>
                <span class="font-mono text-xs font-black tabular-nums text-gray-900 dark:text-white">
                  {{ percentage(item.count, messageTypeTotal) }}%
                </span>
              </div>
              <div class="mt-2 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
                <div
                  class="h-full rounded-full bg-pink-500 dark:bg-pink-400"
                  :style="{ width: `${percentage(item.count, messageTypeTotal)}%` }"
                />
              </div>
              <div class="mt-1.5 font-mono text-[10px] text-gray-400 dark:text-zinc-500">
                {{ formatValue(item.count) }}
              </div>
            </div>
          </div>
          <div v-else class="flex h-28 items-center justify-center text-xs text-gray-400 dark:text-zinc-600">
            {{ t('noData') }}
          </div>
        </section>
      </ThemeCard>

      <ThemeCard>
        <section class="min-w-0 p-5 sm:p-6">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3
                class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300"
              >
                <span class="inline-block h-2 w-2 rounded-full bg-pink-500 dark:bg-pink-400" />
                {{ t('sections.textLength') }}
              </h3>
              <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
                {{ t('overview.textRatio') }} {{ textMessageRatio }}%
              </p>
            </div>
            <div class="flex shrink-0 gap-3 text-right">
              <div>
                <div class="font-mono text-sm font-black text-gray-900 dark:text-white">
                  {{ textLength.median ?? '-' }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-zinc-500">{{ t('length.median') }}</div>
              </div>
              <div>
                <div class="font-mono text-sm font-black text-gray-900 dark:text-white">
                  {{ textLength.p90 ?? '-' }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-zinc-500">P90</div>
              </div>
            </div>
          </div>
          <div v-if="textLength.textMessageCount" class="mt-5 flex h-24 items-end gap-2">
            <div
              v-for="bucket in textLength.buckets"
              :key="bucket.key"
              class="flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              <div class="flex h-16 w-full items-end rounded-sm bg-gray-100 dark:bg-zinc-800">
                <div
                  class="w-full rounded-sm bg-pink-500/80 dark:bg-pink-400/80"
                  :style="{ height: `${Math.max(4, (bucket.count / maxLengthBucket) * 100)}%` }"
                  :title="`${bucket.key}: ${bucket.count}`"
                />
              </div>
              <span class="w-full truncate text-center font-mono text-[9px] text-gray-400 dark:text-zinc-500">
                {{ bucket.key }}
              </span>
            </div>
          </div>
          <div v-else class="flex h-24 items-center justify-center text-xs text-gray-400 dark:text-zinc-600">
            {{ t('noTextData') }}
          </div>
        </section>
      </ThemeCard>
    </div>

    <ThemeCard class="xl:col-span-3">
      <section class="h-full min-w-0 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3
              class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300"
            >
              <span class="inline-block h-2 w-2 rounded-full bg-pink-500 dark:bg-pink-400" />
              {{ t('overview.activity') }}
            </h3>
            <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
              {{ t('sections.activityDescription') }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <div class="font-mono text-lg font-black tabular-nums text-gray-900 dark:text-white">
              {{ metrics.activeDayCount }}
            </div>
            <div class="text-[10px] text-gray-400 dark:text-zinc-500">
              {{ t('overview.activeRate', { rate: activeRate }) }}
            </div>
          </div>
        </div>
        <div class="mt-5">
          <InsightCalendarGrid :t="t" :range="range" :data="calendarData" />
        </div>
      </section>
    </ThemeCard>
  </div>
</template>
