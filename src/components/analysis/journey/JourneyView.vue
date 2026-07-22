<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { JourneyStats } from '@openchatlab/core'
import type { TimeFilter } from '@openchatlab/shared-types'
import { EmptyState, LoadingState, SectionCard } from '@/components/UI'
import { useDataService } from '@/services'
import { reportError } from '@/services/log-report'
import JourneyReportCard from './JourneyReportCard.vue'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  timeRange?: { start: number; end: number } | null
}>()

const { t, locale } = useI18n()
const stats = ref<JourneyStats | null>(null)
const isLoading = ref(false)
const loadFailed = ref(false)

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
)
const monthFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short' }))
const isFiltered = computed(() => {
  if (!props.timeRange) return false
  return (
    (props.timeFilter?.startTs != null && props.timeFilter.startTs > props.timeRange.start) ||
    (props.timeFilter?.endTs != null && props.timeFilter.endTs < props.timeRange.end)
  )
})
const hasData = computed(() => stats.value?.range != null)
const maxYearMessageCount = computed(() => Math.max(...(stats.value?.years.map((year) => year.messageCount) ?? []), 1))

const milestones = computed(() => {
  if (!stats.value?.range) return []
  const result = [
    {
      id: 'start',
      order: 0,
      timestamp: stats.value.range.firstMessageTs,
      icon: 'i-heroicons-play-solid',
      iconClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
      title: t('views.journey.milestones.start'),
      date: formatDate(stats.value.range.firstMessageTs),
      detail: t('views.journey.milestones.startDetail'),
    },
  ]

  if (stats.value.peakMonth) {
    result.push({
      id: 'peak',
      order: 1,
      timestamp: monthTimestamp(stats.value.peakMonth.month),
      icon: 'i-heroicons-sparkles-solid',
      iconClass: 'bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400',
      title: t('views.journey.milestones.peak'),
      date: formatMonth(stats.value.peakMonth.month),
      detail: t('views.journey.milestones.peakDetail', {
        count: formatNumber(stats.value.peakMonth.messageCount),
      }),
    })
  }

  if (stats.value.longestSegment) {
    result.push({
      id: 'conversation',
      order: 2,
      timestamp: stats.value.longestSegment.startTs,
      icon: 'i-heroicons-chat-bubble-left-right-solid',
      iconClass: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
      title: t('views.journey.milestones.longestConversation'),
      date: formatDate(stats.value.longestSegment.startTs),
      detail: t('views.journey.milestones.conversationDetail', {
        duration: formatDuration(stats.value.longestSegment.durationSeconds),
        count: formatNumber(stats.value.longestSegment.messageCount),
      }),
    })
  }

  if (stats.value.longestSilence) {
    result.push({
      id: 'silence',
      order: 3,
      timestamp: stats.value.longestSilence.endTs,
      icon: 'i-heroicons-moon-solid',
      iconClass: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
      title: t('views.journey.milestones.longestSilence'),
      date: t('views.journey.milestones.silenceRange', {
        start: formatDate(stats.value.longestSilence.startTs),
        end: formatDate(stats.value.longestSilence.endTs),
      }),
      detail: stats.value.longestSilence.reopenedBy
        ? t('views.journey.milestones.silenceDetailWithMember', {
            duration: formatDuration(stats.value.longestSilence.durationSeconds),
            name: stats.value.longestSilence.reopenedBy.name,
          })
        : t('views.journey.milestones.silenceDetail', {
            duration: formatDuration(stats.value.longestSilence.durationSeconds),
          }),
    })
  }

  result.push({
    id: 'end',
    order: 4,
    timestamp: stats.value.range.lastMessageTs,
    icon: 'i-heroicons-flag-solid',
    iconClass: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    title: t('views.journey.milestones.end'),
    date: formatDate(stats.value.range.lastMessageTs),
    detail: t(isFiltered.value ? 'views.journey.milestones.filteredEndDetail' : 'views.journey.milestones.endDetail'),
  })

  return result.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)

async function loadData(): Promise<void> {
  if (!props.sessionId) return
  isLoading.value = true
  loadFailed.value = false
  try {
    stats.value = await useDataService().getJourneyStats(props.sessionId, props.timeFilter)
  } catch (error) {
    stats.value = null
    loadFailed.value = true
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to load journey stats:', error)
    reportError(`Journey stats load failed: ${message}`, error instanceof Error ? error.stack : undefined)
  } finally {
    isLoading.value = false
  }
}

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

function monthTimestamp(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return Math.floor(new Date(year, monthNumber - 1, 1).getTime() / 1000)
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

function yearBarWidth(messageCount: number): string {
  if (messageCount === 0) return '0%'
  return `${Math.max(4, Math.round((messageCount / maxYearMessageCount.value) * 100))}%`
}
</script>

<template>
  <div :class="isLoading ? 'h-full' : ''">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />
    <div v-else class="main-content mx-auto max-w-[920px] space-y-6 p-4 sm:p-6">
      <EmptyState
        v-if="!hasData"
        icon="🗓️"
        :text="t(loadFailed ? 'views.journey.loadError' : 'views.journey.empty')"
        padding="lg"
      />

      <template v-else-if="stats">
        <JourneyReportCard :stats="stats" :filtered="isFiltered" />

        <SectionCard
          :title="t('views.journey.milestones.title')"
          :description="t('views.journey.milestones.description')"
          :show-divider="false"
        >
          <div class="grid gap-4 px-5 pb-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            <div v-for="milestone in milestones" :key="milestone.id" class="flex min-w-0 items-start gap-3 py-1">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" :class="milestone.iconClass">
                <UIcon :name="milestone.icon" class="h-4 w-4" />
              </div>
              <div class="min-w-0">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ milestone.title }}</p>
                <p class="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">{{ milestone.date }}</p>
                <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{{ milestone.detail }}</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          :title="t('views.journey.years.title')"
          :description="t('views.journey.years.description')"
          :show-divider="false"
        >
          <div class="space-y-3 px-5 pb-5 sm:px-6 sm:pb-6">
            <div
              v-for="year in stats.years"
              :key="year.year"
              class="grid gap-3 rounded-xl bg-gray-50/70 px-4 py-3 dark:bg-white/[0.025] sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center"
            >
              <div class="font-mono text-xl font-black tabular-nums text-gray-900 dark:text-white">
                {{ year.year }}
              </div>
              <div class="min-w-0">
                <div class="h-1.5 overflow-hidden rounded-full bg-gray-200/80 dark:bg-white/10">
                  <div
                    class="h-full rounded-full bg-pink-400 dark:bg-pink-400/80"
                    :style="{ width: yearBarWidth(year.messageCount) }"
                  />
                </div>
                <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <template v-if="year.messageCount > 0">
                    {{
                      t('views.journey.years.summary', {
                        messages: formatNumber(year.messageCount),
                        days: formatNumber(year.activeDays),
                        months: formatNumber(year.activeMonths),
                      })
                    }}
                  </template>
                  <template v-else>{{ t('views.journey.years.quiet') }}</template>
                </p>
              </div>
              <div v-if="year.messageCount > 0" class="text-left sm:min-w-28 sm:text-right">
                <p class="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {{ formatMonth(year.peakMonth) }}
                </p>
                <p class="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                  {{ t('views.journey.years.peak', { count: formatNumber(year.peakMonthMessageCount) }) }}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </template>
    </div>
  </div>
</template>
