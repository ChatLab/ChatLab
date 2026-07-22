<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DuoProfileStats } from '@openchatlab/core'
import { ReportCard } from '@/components/UI'

type ReadyDuoProfileStats = Extract<DuoProfileStats, { status: 'ready' }>

const props = defineProps<{
  stats: ReadyDuoProfileStats
  filtered?: boolean
}>()

const { t, locale } = useI18n()
const numberFormatter = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
)
const owner = computed(() => props.stats.members[0])
const counterpart = computed(() => props.stats.members[1])

const metrics = computed(() => {
  const totalInitiated = (owner.value.initiatedSegments ?? 0) + (counterpart.value.initiatedSegments ?? 0)
  return [
    {
      key: 'message-share',
      label: t('views.duoProfile.metrics.messageShare'),
      owner: formatPercent(owner.value.messageShare),
      counterpart: formatPercent(counterpart.value.messageShare),
    },
    {
      key: 'initiated-share',
      label: t('views.duoProfile.metrics.initiatedShare'),
      owner:
        owner.value.initiatedSegments == null
          ? '—'
          : formatPercent(percentage(owner.value.initiatedSegments, totalInitiated)),
      counterpart:
        counterpart.value.initiatedSegments == null
          ? '—'
          : formatPercent(percentage(counterpart.value.initiatedSegments, totalInitiated)),
    },
    {
      key: 'response',
      label: t('views.duoProfile.metrics.averageResponse'),
      owner: formatDuration(owner.value.avgResponseSeconds),
      counterpart: formatDuration(counterpart.value.avgResponseSeconds),
    },
    {
      key: 'text-length',
      label: t('views.duoProfile.metrics.averageTextLength'),
      owner: formatTextLength(owner.value.avgTextLength),
      counterpart: formatTextLength(counterpart.value.avgTextLength),
    },
  ]
})

const commonHours = computed(() => {
  if (props.stats.common.commonActiveHours.length === 0) return t('views.duoProfile.hero.noCommonHours')
  return props.stats.common.commonActiveHours.map(formatHour).join(' · ')
})

function percentage(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function formatNumber(value: number): string {
  return numberFormatter.value.format(value)
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`
}

function formatTextLength(value: number | null): string {
  return value == null ? '—' : t('views.duoProfile.units.characters', { count: formatNumber(value) })
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60) return t('views.duoProfile.duration.seconds', { count: Math.max(1, Math.round(seconds)) })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('views.duoProfile.duration.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0
    ? t('views.duoProfile.duration.hoursMinutes', { hours, minutes: remainingMinutes })
    : t('views.duoProfile.duration.hours', { count: hours })
}
</script>

<template>
  <ReportCard>
    <div class="relative z-10 px-5 pt-7 pb-5 sm:px-8 sm:pt-9">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-bold tracking-[0.18em] text-gray-400 uppercase dark:text-gray-500">
            {{ t('views.duoProfile.hero.eyebrow') }}
          </p>
          <h2 class="mt-2 text-xl font-black tracking-tight text-gray-900 dark:text-white sm:text-2xl">
            {{ t('views.duoProfile.hero.title') }}
          </h2>
        </div>
        <div
          class="rounded-full bg-gray-100 px-3 py-1.5 text-[11px] font-medium text-gray-500 dark:bg-white/5 dark:text-gray-400"
        >
          {{ dateFormatter.format(stats.range.firstMessageTs * 1000) }} –
          {{ dateFormatter.format(stats.range.lastMessageTs * 1000) }}
          <span v-if="filtered">· {{ t('views.duoProfile.hero.filtered') }}</span>
        </div>
      </div>

      <div class="mt-7 grid grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] items-end gap-2 sm:gap-5">
        <div class="min-w-0 text-left">
          <span
            class="inline-flex rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-pink-600 dark:bg-pink-500/10 dark:text-pink-400"
          >
            {{ t('views.duoProfile.hero.owner') }}
          </span>
          <p class="mt-2 truncate text-lg font-black text-gray-900 dark:text-white" :title="owner.name">
            {{ owner.name }}
          </p>
        </div>
        <p class="pb-1 text-center text-[10px] font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500">
          {{ t('views.duoProfile.hero.compare') }}
        </p>
        <div class="min-w-0 text-right">
          <span
            class="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
          >
            {{ t('views.duoProfile.hero.counterpart') }}
          </span>
          <p class="mt-2 truncate text-lg font-black text-gray-900 dark:text-white" :title="counterpart.name">
            {{ counterpart.name }}
          </p>
        </div>
      </div>

      <div class="relative mt-4 overflow-hidden rounded-2xl bg-gray-50/80 px-3 py-2 dark:bg-white/[0.025] sm:px-5">
        <div
          v-for="metric in metrics"
          :key="metric.key"
          class="relative grid min-h-14 grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)] items-center gap-2 py-2 sm:gap-3"
        >
          <p
            class="min-w-0 truncate text-left text-base font-black tabular-nums text-pink-500 dark:text-pink-400 lg:text-lg"
          >
            {{ metric.owner }}
          </p>
          <p class="px-1 text-center text-[10px] font-semibold leading-4 text-gray-500 dark:text-gray-400 sm:text-xs">
            {{ metric.label }}
          </p>
          <p
            class="min-w-0 truncate text-right text-base font-black tabular-nums text-indigo-500 dark:text-indigo-400 lg:text-lg"
          >
            {{ metric.counterpart }}
          </p>
        </div>
      </div>
    </div>

    <div class="relative z-10 grid gap-3 px-5 pb-6 sm:px-8 lg:grid-cols-2">
      <div class="rounded-xl bg-pink-50/60 px-4 py-3 dark:bg-pink-500/[0.07]">
        <p class="text-[10px] font-bold tracking-wide text-pink-500 uppercase dark:text-pink-400">
          {{ t('views.duoProfile.hero.commonHours') }}
        </p>
        <p class="mt-1.5 truncate text-sm font-black text-gray-900 dark:text-white" :title="commonHours">
          {{ commonHours }}
        </p>
      </div>
      <div class="rounded-xl bg-indigo-50/60 px-4 py-3 dark:bg-indigo-500/[0.07]">
        <p class="text-[10px] font-bold tracking-wide text-indigo-500 uppercase dark:text-indigo-400">
          {{ t('views.duoProfile.hero.sameDayOverlap') }}
        </p>
        <p class="mt-1.5 text-sm font-black tabular-nums text-gray-900 dark:text-white">
          {{ formatPercent(stats.common.activeDayOverlapRate) }}
          <span class="ml-1 text-[10px] font-medium text-gray-400">
            {{
              t('views.duoProfile.hero.activeDayDetail', {
                intersection: formatNumber(stats.common.activeDayIntersection),
                union: formatNumber(stats.common.activeDayUnion),
              })
            }}
          </span>
        </p>
      </div>
    </div>

    <div
      class="relative z-10 flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
    >
      <div class="flex items-center gap-1.5">
        <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
        <span class="text-[10px] font-bold tracking-wider uppercase">ChatLab</span>
      </div>
      <span class="text-[9px] font-medium tracking-widest uppercase">{{ t('views.duoProfile.watermark') }}</span>
    </div>
  </ReportCard>
</template>
