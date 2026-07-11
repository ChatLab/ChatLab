<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { AnnualSummaryFetchOptions } from '@/services/data/types'
import type { AnnualSummaryResponse } from '@openchatlab/shared-types'
import LoadingState from '@/components/UI/LoadingState.vue'
import { useDataService } from '@/services'
import { reportError } from '@/services/log-report'
import { useAnnualSummaryTimeRange } from '../annual-summary-time-range'
import AnnualInsightBoard from './components/AnnualInsightBoard.vue'

const { t } = useI18n()
const router = useRouter()
const currentYear = new Date().getFullYear()
const timeRange = useAnnualSummaryTimeRange()
const response = ref<AnnualSummaryResponse | null>(null)
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
const isUpdating = computed(() => response.value?.task.status === 'running')
const hasSnapshot = computed(() => response.value?.metrics !== null && response.value?.metrics !== undefined)
const isZeroData = computed(() => hasSnapshot.value && response.value?.metrics?.sentMessageCount === 0)
const hasNoAnalyzableOwner = computed(
  () =>
    (response.value?.coverage.totalSessions ?? 0) > 0 &&
    response.value?.coverage.analyzedSessions === 0 &&
    ownerIssueCount.value > 0
)
const selectedYear = computed(() =>
  timeRange.modelValue.value?.state.mode === 'year' ? timeRange.modelValue.value.state.year : undefined
)

watch(
  requestKey,
  () => {
    clearPoll()
    if (!requestOptions.value) return
    response.value = null
    void loadSummary(false)
  },
  { immediate: true }
)

onBeforeUnmount(clearPoll)

async function loadSummary(recompute: boolean): Promise<void> {
  const options = requestOptions.value
  if (!options) return
  const token = ++requestToken
  errorMessage.value = ''
  try {
    const result = recompute
      ? await useDataService().recomputeAnnualSummary(options)
      : await useDataService().getAnnualSummary(options)
    if (token !== requestToken) return
    response.value = result
    if (result.metrics) {
      timeRange.setAvailableYears(result.availableDataYears)
    }
    if (result.task.status === 'running') schedulePoll()
  } catch (error) {
    if (token !== requestToken) return
    const message = error instanceof Error ? error.message : String(error)
    errorMessage.value = message
    reportError(`Global insight annual summary failed: ${message}`, error instanceof Error ? error.stack : undefined)
  }
}

function schedulePoll(): void {
  clearPoll()
  pollTimer = setTimeout(() => void loadSummary(false), 900)
}

function clearPoll(): void {
  if (!pollTimer) return
  clearTimeout(pollTimer)
  pollTimer = null
}

function switchToLatestYear(): void {
  const year = response.value?.latestDataYear
  if (!year) return
  timeRange.switchToYear(year)
}

function openSessions(): void {
  void router.push('/')
}
</script>

<template>
  <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-[1120px] space-y-6 px-4 py-5 sm:px-6 sm:py-6">
      <div
        v-if="response?.cache.status === 'stale' || (isUpdating && hasSnapshot)"
        class="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-2.5 text-xs text-amber-800 backdrop-blur-sm dark:border-amber-950/40 dark:bg-amber-950/20 dark:text-amber-300"
      >
        <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
        {{ t('insight.status.updating') }}
      </div>

      <div
        v-if="errorMessage || response?.task.status === 'failed'"
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-150 bg-red-50/50 px-4 py-2.5 text-xs text-red-800 backdrop-blur-sm dark:border-red-950/40 dark:bg-red-950/20 dark:text-red-300"
      >
        <span>{{ t('insight.status.failed') }}</span>
        <UButton size="xs" color="error" variant="soft" icon="i-heroicons-arrow-path" @click="loadSummary(true)">
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
            : t('insight.status.loading')
        "
      />

      <template v-else-if="response?.metrics && response.textLength">
        <div
          v-if="isZeroData"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-150 bg-white p-4 text-xs text-gray-600 dark:border-zinc-850 dark:bg-zinc-900/50 dark:text-zinc-300"
        >
          <span v-if="hasNoAnalyzableOwner">{{ t('insight.status.noAnalyzableOwner') }}</span>
          <span v-else-if="response.latestDataYear && selectedYear !== response.latestDataYear">
            {{ t('insight.status.noDataWithLatest', { year: selectedYear, latestYear: response.latestDataYear }) }}
          </span>
          <span v-else>{{ t('insight.noData') }}</span>
          <UButton
            v-if="hasNoAnalyzableOwner"
            size="xs"
            variant="soft"
            color="neutral"
            icon="i-heroicons-user-circle"
            @click="openSessions"
          >
            {{ t('insight.actions.openSessions') }}
          </UButton>
          <UButton
            v-else-if="response.latestDataYear && selectedYear !== response.latestDataYear"
            size="xs"
            variant="soft"
            color="neutral"
            icon="i-heroicons-arrow-right"
            @click="switchToLatestYear"
          >
            {{ t('insight.actions.switchYear', { year: response.latestDataYear }) }}
          </UButton>
        </div>

        <AnnualInsightBoard
          :range="response.range"
          :metrics="response.metrics"
          :coverage="response.coverage"
          :owner-issue-count="ownerIssueCount"
          :monthly-activity="response.monthlyActivity"
          :daily-activity="response.dailyActivity"
          :message-types="response.messageTypes"
          :text-length="response.textLength"
          @open-sessions="openSessions"
        />
      </template>
    </div>
  </main>
</template>
