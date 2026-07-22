<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DuoProfileMember, DuoProfileStats } from '@openchatlab/core'
import type { TimeFilter } from '@openchatlab/shared-types'
import { EmptyState, LoadingState, SectionCard } from '@/components/UI'
import { useDataService } from '@/services'
import { reportError } from '@/services/log-report'
import { getMessageTypeName } from '@/types/base'
import DuoProfileReportCard from './DuoProfileReportCard.vue'

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  timeRange?: { start: number; end: number } | null
}>()

const { t, locale } = useI18n()
const stats = ref<DuoProfileStats | null>(null)
const isLoading = ref(false)
const loadFailed = ref(false)
const numberFormatter = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
const readyStats = computed(() => (stats.value?.status === 'ready' ? stats.value : null))
const owner = computed(() => readyStats.value?.members[0] ?? null)
const counterpart = computed(() => readyStats.value?.members[1] ?? null)
const isFiltered = computed(() => {
  if (!props.timeRange) return false
  return (
    (props.timeFilter?.startTs != null && props.timeFilter.startTs > props.timeRange.start) ||
    (props.timeFilter?.endTs != null && props.timeFilter.endTs < props.timeRange.end)
  )
})

const interactionRows = computed(() => {
  if (!owner.value || !counterpart.value) return []
  return [
    compareRow('initiated', t('views.duoProfile.metrics.initiatedSegments'), owner.value, counterpart.value, (member) =>
      formatNullableCount(member.initiatedSegments, 'views.duoProfile.units.segments')
    ),
    compareRow('closed', t('views.duoProfile.metrics.closedSegments'), owner.value, counterpart.value, (member) =>
      formatNullableCount(member.closedSegments, 'views.duoProfile.units.segments')
    ),
    compareRow(
      'response',
      t('views.duoProfile.metrics.averageResponse'),
      owner.value,
      counterpart.value,
      (member) => formatDuration(member.avgResponseSeconds),
      (member) => formatResponseSamples(member.responseCount)
    ),
    compareRow(
      'continuation',
      t('views.duoProfile.metrics.continuationRate'),
      owner.value,
      counterpart.value,
      (member) => formatNullablePercent(member.continuationRate)
    ),
  ]
})

const expressionRows = computed(() => {
  if (!owner.value || !counterpart.value) return []
  return [
    compareRow('messages', t('views.duoProfile.metrics.messages'), owner.value, counterpart.value, (member) =>
      t('views.duoProfile.units.messages', { count: formatNumber(member.messageCount) })
    ),
    compareRow('share', t('views.duoProfile.metrics.messageShare'), owner.value, counterpart.value, (member) =>
      formatPercent(member.messageShare)
    ),
    compareRow('length', t('views.duoProfile.metrics.averageTextLength'), owner.value, counterpart.value, (member) =>
      member.avgTextLength == null
        ? '—'
        : t('views.duoProfile.units.characters', { count: formatNumber(member.avgTextLength) })
    ),
    compareRow('short', t('views.duoProfile.metrics.shortTextRate'), owner.value, counterpart.value, (member) =>
      formatPercent(member.shortTextRate)
    ),
    compareRow('long', t('views.duoProfile.metrics.longTextRate'), owner.value, counterpart.value, (member) =>
      formatPercent(member.longTextRate)
    ),
    compareRow('non-text', t('views.duoProfile.metrics.nonTextRate'), owner.value, counterpart.value, (member) =>
      formatPercent(member.nonTextRate)
    ),
    compareRow('top-type', t('views.duoProfile.metrics.topNonTextType'), owner.value, counterpart.value, (member) =>
      member.topNonTextType ? getMessageTypeName(member.topNonTextType.type, t) : '—'
    ),
  ]
})

const unavailableText = computed(() => {
  if (loadFailed.value) return t('views.duoProfile.states.loadError')
  if (!stats.value || stats.value.status === 'ready') return ''
  if (stats.value.reason === 'ambiguous') {
    return t('views.duoProfile.states.ambiguous', { count: stats.value.candidateCount ?? 0 })
  }
  return t(`views.duoProfile.states.${stats.value.reason}`)
})

watch(
  () => [props.sessionId, props.timeFilter?.startTs, props.timeFilter?.endTs],
  () => loadData(),
  { immediate: true }
)

async function loadData(): Promise<void> {
  if (!props.sessionId) return
  isLoading.value = true
  loadFailed.value = false
  try {
    const filter = props.timeFilter ? { startTs: props.timeFilter.startTs, endTs: props.timeFilter.endTs } : undefined
    stats.value = await useDataService().getDuoProfileStats(props.sessionId, filter)
  } catch (error) {
    stats.value = null
    loadFailed.value = true
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to load duo profile stats:', error)
    reportError(`Duo profile stats load failed: ${message}`, error instanceof Error ? error.stack : undefined)
  } finally {
    isLoading.value = false
  }
}

function compareRow(
  key: string,
  label: string,
  left: DuoProfileMember,
  right: DuoProfileMember,
  format: (member: DuoProfileMember) => string,
  formatHint?: (member: DuoProfileMember) => string
) {
  return {
    key,
    label,
    owner: format(left),
    counterpart: format(right),
    ownerHint: formatHint?.(left) ?? '',
    counterpartHint: formatHint?.(right) ?? '',
  }
}

function formatNumber(value: number): string {
  return numberFormatter.value.format(value)
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`
}

function formatNullablePercent(value: number | null): string {
  return value == null ? '—' : formatPercent(value)
}

function formatNullableCount(value: number | null, key: string): string {
  return value == null ? '—' : t(key, { count: formatNumber(value) })
}

function formatResponseSamples(value: number | null): string {
  return value == null ? '' : t('views.duoProfile.units.responseSamples', { count: formatNumber(value) })
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

function formatHour(hour: number | null): string {
  return hour == null ? '—' : `${String(hour).padStart(2, '0')}:00`
}

function hourCellStyle(member: DuoProfileMember, count: number): { opacity: number } {
  const max = Math.max(...member.hourlyActivity, 1)
  return { opacity: count === 0 ? 0.08 : 0.22 + (count / max) * 0.78 }
}
</script>

<template>
  <div :class="isLoading ? 'h-full' : ''">
    <LoadingState v-if="isLoading" variant="page" :text="t('common.loading')" />
    <div v-else class="main-content mx-auto max-w-[920px] space-y-6 p-4 sm:p-6">
      <EmptyState v-if="!readyStats" icon="👥" :text="unavailableText" padding="lg" />

      <template v-else-if="owner && counterpart">
        <DuoProfileReportCard :stats="readyStats" :filtered="isFiltered" />

        <SectionCard
          :title="t('views.duoProfile.sections.interaction.title')"
          :description="t('views.duoProfile.sections.interaction.description')"
          :show-divider="false"
        >
          <div class="px-5 pb-5 sm:px-6 sm:pb-6">
            <div
              v-if="!readyStats.hasSessionIndex"
              class="mb-3 flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-5 text-gray-500 dark:bg-white/[0.03] dark:text-gray-400"
            >
              <UIcon name="i-heroicons-information-circle" class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{{ t('views.duoProfile.states.noIndex') }}</span>
            </div>
            <div class="divide-y divide-gray-100 dark:divide-white/5">
              <div
                v-for="row in interactionRows"
                :key="row.key"
                class="grid min-h-14 grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-3 py-3"
              >
                <div class="min-w-0 text-left">
                  <p class="truncate text-sm font-bold tabular-nums text-pink-500 dark:text-pink-400">
                    {{ row.owner }}
                  </p>
                  <p v-if="row.ownerHint" class="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">
                    {{ row.ownerHint }}
                  </p>
                </div>
                <p class="text-center text-xs font-medium leading-4 text-gray-500 dark:text-gray-400">
                  {{ row.label }}
                </p>
                <div class="min-w-0 text-right">
                  <p class="truncate text-sm font-bold tabular-nums text-indigo-500 dark:text-indigo-400">
                    {{ row.counterpart }}
                  </p>
                  <p v-if="row.counterpartHint" class="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">
                    {{ row.counterpartHint }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          :title="t('views.duoProfile.sections.expression.title')"
          :description="t('views.duoProfile.sections.expression.description')"
          :show-divider="false"
        >
          <div class="divide-y divide-gray-100 px-5 pb-5 dark:divide-white/5 sm:px-6 sm:pb-6">
            <div
              v-for="row in expressionRows"
              :key="row.key"
              class="grid min-h-14 grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-3 py-3"
            >
              <p class="truncate text-left text-sm font-bold tabular-nums text-pink-500 dark:text-pink-400">
                {{ row.owner }}
              </p>
              <p class="text-center text-xs font-medium leading-4 text-gray-500 dark:text-gray-400">
                {{ row.label }}
              </p>
              <p class="truncate text-right text-sm font-bold tabular-nums text-indigo-500 dark:text-indigo-400">
                {{ row.counterpart }}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          :title="t('views.duoProfile.sections.schedule.title')"
          :description="t('views.duoProfile.sections.schedule.description')"
          :show-divider="false"
        >
          <div class="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <div
              v-for="member in readyStats.members"
              :key="member.memberId"
              class="rounded-xl bg-gray-50/70 px-4 py-4 dark:bg-white/[0.025]"
            >
              <div class="flex min-w-0 items-center justify-between gap-3">
                <p class="truncate text-sm font-bold text-gray-900 dark:text-white" :title="member.name">
                  {{ member.name }}
                </p>
                <p class="shrink-0 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                  {{ t('views.duoProfile.metrics.peakHour') }} {{ formatHour(member.peakHour) }}
                </p>
              </div>
              <div class="mt-3 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-px">
                <div
                  v-for="(count, hour) in member.hourlyActivity"
                  :key="hour"
                  class="h-7 rounded-[2px]"
                  :class="member.role === 'owner' ? 'bg-pink-500' : 'bg-indigo-500'"
                  :style="hourCellStyle(member, count)"
                  :title="`${formatHour(hour)} · ${formatNumber(count)}`"
                />
              </div>
              <div class="mt-1.5 flex justify-between text-[9px] font-medium text-gray-400 dark:text-gray-500">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
              <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{{ t('views.duoProfile.metrics.activeDays') }} {{ formatNumber(member.activeDays) }}</span>
                <span>{{ t('views.duoProfile.metrics.nightRate') }} {{ formatPercent(member.nightRate) }}</span>
                <span>{{ t('views.duoProfile.metrics.weekendRate') }} {{ formatPercent(member.weekendRate) }}</span>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="rounded-xl border border-gray-100 px-4 py-3 dark:border-white/5">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ t('views.duoProfile.metrics.hourlyOverlap') }}
                </p>
                <p class="mt-1 text-xl font-black tabular-nums text-gray-900 dark:text-white">
                  {{ formatPercent(readyStats.common.hourlyOverlapRate) }}
                </p>
              </div>
              <div class="rounded-xl border border-gray-100 px-4 py-3 dark:border-white/5">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ t('views.duoProfile.metrics.sameDayOverlap') }}
                </p>
                <p class="mt-1 text-xl font-black tabular-nums text-gray-900 dark:text-white">
                  {{ formatPercent(readyStats.common.activeDayOverlapRate) }}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </template>
    </div>
  </div>
</template>
