<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  AnnualSummaryCoverage,
  AnnualSummaryMetrics,
  AnnualSummaryRange,
  AnnualSummaryTextLength,
} from '@openchatlab/shared-types'
import { MessageType, getMessageTypeName } from '@/types/base'
import { formatDateRange } from '@/utils'
import { ThemeCard } from '@/components/UI'
import AnnualCalendarGrid from './AnnualCalendarGrid.vue'
import AnnualMessageTrend from './AnnualMessageTrend.vue'

const props = defineProps<{
  range: AnnualSummaryRange
  metrics: AnnualSummaryMetrics
  coverage: AnnualSummaryCoverage
  ownerIssueCount: number
  monthlyActivity: Array<{ month: string; messageCount: number }>
  dailyActivity: Array<{ date: string; messageCount: number }>
  messageTypes: Array<{ type: number; count: number }>
  textLength: AnnualSummaryTextLength
}>()

const emit = defineEmits<{
  openSessions: []
}>()

const { t } = useI18n()

const title = computed(() =>
  props.range.mode === 'year'
    ? t('insight.overviewCard.yearTitle', { year: props.range.year })
    : t('insight.overviewCard.recentTitle')
)
const timeRangeText = computed(() => formatDateRange(props.range.startTs, props.range.endTs, 'YYYY/MM/DD'))
const primaryStats = computed(() => [
  { key: 'messages', value: props.metrics.sentMessageCount },
  { key: 'activeDays', value: props.metrics.activeDayCount },
  { key: 'contacts', value: props.metrics.directContactCount },
  { key: 'dailyMessages', value: props.metrics.averageMessagesPerDay },
])
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
const highlights = computed(() => [
  {
    key: 'dailyContacts',
    value: formatValue(props.metrics.averageDirectContactsPerDay),
    detail: t('insight.overviewCard.perDay'),
  },
  {
    key: 'peakMonth',
    value: formatMonth(peakMonth.value?.month),
    detail: t('insight.overviewCard.messagesCount', { count: formatValue(peakMonth.value?.messageCount ?? 0) }),
  },
  {
    key: 'peakDay',
    value: peakDay.value?.date.slice(5).replace('-', '/') ?? '-',
    detail: t('insight.overviewCard.messagesCount', { count: formatValue(peakDay.value?.messageCount ?? 0) }),
  },
])

function formatValue(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatMonth(month: string | undefined): string {
  if (!month) return '-'
  return props.range.mode === 'year'
    ? t('insight.monthLabel', { month: Number(month.slice(5)) })
    : month.replace('-', '/')
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-12">
    <ThemeCard variant="elevated" decorative :capturable="false" class="!ring-0 lg:col-span-8">
      <section class="relative z-10 min-w-0 p-5 sm:p-6">
        <div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0">
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">{{ title }}</h2>
            <div class="mt-3 space-y-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400">
              <div class="flex items-center gap-2">
                <UIcon name="i-heroicons-calendar" class="h-4 w-4 opacity-70" />
                <span class="font-mono">{{ timeRangeText }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <UIcon name="i-heroicons-circle-stack" class="h-4 w-4 opacity-70" />
                <span>
                  {{
                    t('insight.status.coverage', {
                      analyzed: coverage.analyzedSessions,
                      total: coverage.totalSessions,
                    })
                  }}
                </span>
                <button
                  v-if="ownerIssueCount > 0"
                  type="button"
                  class="text-pink-600 hover:underline dark:text-pink-400"
                  @click="emit('openSessions')"
                >
                  {{ t('insight.status.ownerIssues', { count: ownerIssueCount }) }}
                </button>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 xl:shrink-0">
            <div v-for="stat in primaryStats" :key="stat.key" class="min-w-0">
              <div class="font-mono text-xl font-black tabular-nums text-gray-900 dark:text-white">
                {{ formatValue(stat.value) }}
              </div>
              <div class="mt-1 truncate text-[10px] font-medium text-gray-500 dark:text-zinc-400">
                {{ t(`insight.kpis.${stat.key}`) }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-7 flex items-center justify-between gap-3">
          <h3 class="text-[11px] font-bold uppercase text-pink-600 dark:text-pink-400">
            {{ t('insight.sections.overview') }}
          </h3>
          <span class="text-[10px] text-gray-400 dark:text-zinc-500">
            {{ t('insight.sections.overviewDescription') }}
          </span>
        </div>
        <div class="mt-2">
          <AnnualMessageTrend :range="range" :data="monthlyActivity" :height="210" />
        </div>
      </section>
    </ThemeCard>

    <ThemeCard variant="elevated" :capturable="false" class="!ring-0 lg:col-span-4">
      <section class="min-w-0 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-[11px] font-bold uppercase text-pink-600 dark:text-pink-400">
              {{ t('insight.overviewCard.activity') }}
            </h3>
            <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
              {{ t('insight.sections.activityDescription') }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <div class="font-mono text-lg font-black tabular-nums text-gray-900 dark:text-white">
              {{ metrics.activeDayCount }}
            </div>
            <div class="text-[9px] text-gray-400 dark:text-zinc-500">
              {{ t('insight.overviewCard.activeRate', { rate: activeRate }) }}
            </div>
          </div>
        </div>
        <div class="mt-5">
          <AnnualCalendarGrid :range="range" :data="dailyActivity" />
        </div>
      </section>
    </ThemeCard>

    <ThemeCard variant="elevated" :capturable="false" class="!ring-0 lg:col-span-5">
      <section class="min-w-0 p-5 sm:p-6">
        <h3 class="text-[11px] font-bold uppercase text-pink-600 dark:text-pink-400">
          {{ t('insight.sections.messageTypes') }}
        </h3>
        <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
          {{ t('insight.sections.messageTypesDescription') }}
        </p>
        <div v-if="sortedMessageTypes.length" class="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
          <div v-for="item in sortedMessageTypes" :key="item.type" class="min-w-0">
            <div class="flex items-end justify-between gap-2">
              <span class="truncate text-xs font-medium text-gray-600 dark:text-zinc-300">
                {{ getMessageTypeName(item.type, t) }}
              </span>
              <span class="font-mono text-xs font-black tabular-nums text-gray-900 dark:text-white">
                {{ percentage(item.count, messageTypeTotal) }}%
              </span>
            </div>
            <div class="mt-2 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
              <div
                class="h-full rounded-full bg-pink-500"
                :style="{ width: `${percentage(item.count, messageTypeTotal)}%` }"
              />
            </div>
            <div class="mt-1.5 font-mono text-[9px] text-gray-400 dark:text-zinc-500">
              {{ formatValue(item.count) }}
            </div>
          </div>
        </div>
        <div v-else class="flex h-28 items-center justify-center text-xs text-gray-400 dark:text-zinc-600">
          {{ t('insight.noData') }}
        </div>
      </section>
    </ThemeCard>

    <ThemeCard variant="elevated" :capturable="false" class="!ring-0 lg:col-span-3">
      <section class="min-w-0 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-[11px] font-bold uppercase text-pink-600 dark:text-pink-400">
              {{ t('insight.sections.textLength') }}
            </h3>
            <p class="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
              {{ t('insight.overviewCard.textRatio') }} {{ textMessageRatio }}%
            </p>
          </div>
          <div class="flex shrink-0 gap-3 text-right">
            <div>
              <div class="font-mono text-sm font-black text-gray-900 dark:text-white">
                {{ textLength.median ?? '-' }}
              </div>
              <div class="text-[9px] text-gray-400 dark:text-zinc-500">{{ t('insight.length.median') }}</div>
            </div>
            <div>
              <div class="font-mono text-sm font-black text-gray-900 dark:text-white">{{ textLength.p90 ?? '-' }}</div>
              <div class="text-[9px] text-gray-400 dark:text-zinc-500">P90</div>
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
                class="w-full rounded-sm bg-blue-500/80 dark:bg-blue-400/80"
                :style="{ height: `${Math.max(4, (bucket.count / maxLengthBucket) * 100)}%` }"
                :title="`${bucket.key}: ${bucket.count}`"
              />
            </div>
            <span class="w-full truncate text-center font-mono text-[8px] text-gray-400 dark:text-zinc-500">
              {{ bucket.key }}
            </span>
          </div>
        </div>
        <div v-else class="flex h-24 items-center justify-center text-xs text-gray-400 dark:text-zinc-600">
          {{ t('insight.noTextData') }}
        </div>
      </section>
    </ThemeCard>

    <ThemeCard variant="elevated" :capturable="false" class="!ring-0 lg:col-span-4">
      <section class="min-w-0 p-5 sm:p-6">
        <h3 class="text-[11px] font-bold uppercase text-pink-600 dark:text-pink-400">
          {{ t('insight.overviewCard.keyMetrics') }}
        </h3>
        <div class="mt-4 grid grid-cols-3 divide-x divide-gray-150 dark:divide-white/10">
          <div v-for="item in highlights" :key="item.key" class="min-w-0 px-3 first:pl-0 last:pr-0">
            <div class="truncate font-mono text-sm font-black tabular-nums text-gray-900 dark:text-white">
              {{ item.value }}
            </div>
            <div class="mt-1 truncate text-[9px] font-medium text-gray-500 dark:text-zinc-400">
              {{ t(`insight.overviewCard.${item.key}`) }}
            </div>
            <div class="mt-0.5 truncate text-[8px] text-gray-400 dark:text-zinc-500">{{ item.detail }}</div>
          </div>
        </div>
      </section>
    </ThemeCard>
  </div>
</template>
