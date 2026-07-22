<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { JourneyStats } from '@openchatlab/core'
import { ReportCard } from '@/components/UI'

const props = defineProps<{
  stats: JourneyStats
  filtered?: boolean
}>()

const { t, locale } = useI18n()

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
)
const monthFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short' }))

const range = computed(() => props.stats.range!)
const maxMonthCount = computed(() => Math.max(...props.stats.months.map((month) => month.messageCount), 1))
const ribbonStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.stats.months.length}, minmax(2px, 1fr))`,
  gap: props.stats.months.length > 96 ? '1px' : '2px',
}))

const spanText = computed(() => {
  const days = range.value.spanDays
  if (days < 30) return t('views.journey.duration.days', { count: days })

  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  if (years > 0) {
    return months > 0
      ? t('views.journey.duration.yearsMonths', { years, months })
      : t('views.journey.duration.years', { count: years })
  }
  return t('views.journey.duration.months', { count: Math.max(1, months) })
})

const metricItems = computed(() => [
  {
    icon: 'i-heroicons-sparkles-solid',
    colorClass: 'text-pink-500 dark:text-pink-400',
    label: t('views.journey.metrics.peakMonth'),
    value: props.stats.peakMonth ? formatMonth(props.stats.peakMonth.month) : '—',
    subtext: props.stats.peakMonth
      ? t('views.journey.metrics.messagesAndDays', {
          messages: formatNumber(props.stats.peakMonth.messageCount),
          days: formatNumber(props.stats.peakMonth.activeDays),
        })
      : '—',
  },
  {
    icon: 'i-heroicons-calendar-days-solid',
    colorClass: 'text-indigo-500 dark:text-indigo-400',
    label: t('views.journey.metrics.activeMonths'),
    value: t('views.journey.metrics.monthsRatio', {
      active: formatNumber(range.value.activeMonths),
      total: formatNumber(range.value.spanMonths),
    }),
    subtext: t('views.journey.metrics.activeDays', { count: formatNumber(range.value.activeDays) }),
  },
  {
    icon: 'i-heroicons-chat-bubble-left-right-solid',
    colorClass: 'text-blue-500 dark:text-blue-400',
    label: t('views.journey.metrics.longestConversation'),
    value: props.stats.longestSegment ? formatDuration(props.stats.longestSegment.durationSeconds) : '—',
    subtext: props.stats.longestSegment
      ? t('views.journey.metrics.conversationDetail', {
          date: formatDate(props.stats.longestSegment.startTs),
          count: formatNumber(props.stats.longestSegment.messageCount),
        })
      : t('views.journey.metrics.noIndex'),
  },
  {
    icon: 'i-heroicons-moon-solid',
    colorClass: 'text-violet-500 dark:text-violet-400',
    label: t('views.journey.metrics.longestSilence'),
    value: props.stats.longestSilence ? formatDuration(props.stats.longestSilence.durationSeconds) : '—',
    subtext: props.stats.longestSilence
      ? props.stats.longestSilence.reopenedBy
        ? t('views.journey.metrics.reopenedBy', { name: props.stats.longestSilence.reopenedBy.name })
        : t('views.journey.metrics.reopened')
      : props.stats.hasSessionIndex
        ? t('views.journey.metrics.noSilence')
        : t('views.journey.metrics.noIndex'),
  },
])

function formatNumber(value: number): string {
  return numberFormatter.value.format(value)
}

function formatDate(timestamp: number): string {
  return dateFormatter.value.format(timestamp * 1000)
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return monthFormatter.value.format(new Date(year, monthNumber - 1, 1))
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  if (totalMinutes < 1) return t('views.journey.duration.lessThanMinute')
  if (totalMinutes < 60) return t('views.journey.duration.minutes', { count: totalMinutes })
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) {
    const minutes = totalMinutes % 60
    return minutes > 0
      ? t('views.journey.duration.hoursMinutes', { hours: totalHours, minutes })
      : t('views.journey.duration.hours', { count: totalHours })
  }
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours > 0
    ? t('views.journey.duration.daysHours', { days, hours })
    : t('views.journey.duration.days', { count: days })
}

function barHeight(messageCount: number): string {
  if (messageCount === 0) return '4px'
  const ratio = Math.sqrt(messageCount / maxMonthCount.value)
  return `${Math.round(10 + ratio * 50)}px`
}

function monthTooltip(month: string, messageCount: number): string {
  return t('views.journey.hero.monthTooltip', {
    month: formatMonth(month),
    count: formatNumber(messageCount),
  })
}
</script>

<template>
  <ReportCard>
    <div class="relative z-10 px-6 pt-8 pb-5 sm:px-8 sm:pt-10">
      <div class="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium tracking-wide text-gray-500 dark:text-gray-400">
            {{ formatDate(range.firstMessageTs) }} – {{ formatDate(range.lastMessageTs) }}
          </p>
          <div class="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="text-xl font-medium text-gray-700 dark:text-gray-300">
              {{ t('views.journey.hero.prefix') }}
            </span>
            <span class="text-4xl font-black tracking-tight text-gray-900 dark:text-white sm:text-5xl">
              {{ spanText }}
            </span>
          </div>
          <p class="mt-3 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            {{
              t(filtered ? 'views.journey.hero.filteredSummary' : 'views.journey.hero.summary', {
                activeMonths: formatNumber(range.activeMonths),
                activeDays: formatNumber(range.activeDays),
              })
            }}
          </p>
        </div>

        <div class="w-full min-w-0 lg:max-w-[380px]">
          <div class="mb-3 flex items-center justify-between gap-4">
            <p class="text-xs font-bold tracking-wide text-gray-700 dark:text-gray-300">
              {{ t('views.journey.hero.footprint') }}
            </p>
            <p class="text-[10px] font-medium text-gray-400 dark:text-gray-500">
              {{ t('views.journey.hero.monthCount', { count: formatNumber(range.spanMonths) }) }}
            </p>
          </div>
          <div
            class="grid h-16 items-end overflow-hidden rounded-xl bg-gray-50/80 px-3 py-2 dark:bg-white/[0.035]"
            :style="ribbonStyle"
          >
            <div
              v-for="month in stats.months"
              :key="month.month"
              class="min-w-0 rounded-t-sm"
              :class="month.messageCount > 0 ? 'bg-pink-400/80 dark:bg-pink-400/75' : 'bg-gray-200 dark:bg-white/10'"
              :style="{ height: barHeight(month.messageCount) }"
              :title="monthTooltip(month.month, month.messageCount)"
            />
          </div>
          <div class="mt-2 flex justify-between text-[10px] font-medium text-gray-400 dark:text-gray-500">
            <span>{{ formatMonth(stats.months[0].month) }}</span>
            <span>{{ formatMonth(stats.months[stats.months.length - 1].month) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="relative z-10 grid grid-cols-2 gap-x-3 gap-y-4 px-4 pt-2 pb-6 sm:px-6 lg:grid-cols-4">
      <div v-for="item in metricItems" :key="item.label" class="flex min-w-0 items-start gap-2.5 px-2 py-1">
        <UIcon :name="item.icon" class="mt-0.5 h-4 w-4 shrink-0" :class="item.colorClass" />
        <div class="min-w-0">
          <p class="truncate text-sm font-black leading-tight tabular-nums" :class="item.colorClass">
            {{ item.value }}
          </p>
          <p class="mt-1 truncate text-[10px] font-semibold text-gray-600 dark:text-gray-300">
            {{ item.label }}
          </p>
          <p class="mt-0.5 line-clamp-2 text-[9px] leading-4 text-gray-400 dark:text-gray-500">
            {{ item.subtext }}
          </p>
        </div>
      </div>
    </div>

    <div
      class="relative z-10 flex items-center justify-between px-6 pb-4 opacity-40 mix-blend-luminosity dark:opacity-30 sm:px-8 sm:pb-5"
    >
      <div class="flex items-center gap-1.5">
        <UIcon name="i-heroicons-chat-bubble-left-right-solid" class="h-3.5 w-3.5" />
        <span class="text-[10px] font-bold uppercase tracking-wider">ChatLab</span>
      </div>
      <span class="text-[9px] font-medium uppercase tracking-widest">
        {{ t('views.journey.watermark') }}
      </span>
    </div>
  </ReportCard>
</template>
