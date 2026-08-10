<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'
import type { ChatTopic } from '@openchatlab/shared-types'
import {
  CHAT_TOPIC_COLOR_STYLES,
  chatTopicColorStyle,
  shouldClearChatTopicHighlight,
  type ChatTopicHighlight,
} from './topic-highlight'
import { resolveChatTopicProgressDetail } from './topic-progress'
import { useToast } from '@/composables/useToast'
import {
  useChatTopicsService,
  type ChatTopicDay,
  type ChatTopicPreflight,
  type ChatTopicRangeKind,
  type ChatTopicRun,
  type CreateChatTopicsRequest,
} from '@/services'

const props = defineProps<{
  sessionId: string
  dayKey?: string | null
}>()

const emit = defineEmits<{
  (event: 'jump-to-message', messageId: number): void
  (event: 'highlight-topic', topic: ChatTopicHighlight | null): void
}>()

const { t, locale } = useI18n()
const toast = useToast()
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const day = ref<ChatTopicDay | null>(null)
const run = ref<ChatTopicRun | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const collapsed = ref(false)
const showCreateModal = ref(false)
const showDeleteModal = ref(false)
type TopicRangeSelection = ChatTopicRangeKind | 'current'
const selectedRange = ref<TopicRangeSelection>('current')
const customStartDay = ref('')
const preflight = ref<ChatTopicPreflight | null>(null)
const preflightLoading = ref(false)
const expandedEvidenceTopicId = ref<string | null>(null)
const selectedTopicId = ref<string | null>(null)
let loadVersion = 0
let preflightVersion = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null

const activeRun = computed(() => run.value && ['pending', 'running'].includes(run.value.status))
const resumableRun = computed(() => run.value && ['paused', 'failed'].includes(run.value.status))
const progressPercent = computed(() => {
  if (!run.value || run.value.totalBlocks === 0) return 0
  return Math.min(100, Math.round((run.value.completedBlocks / run.value.totalBlocks) * 100))
})
const activeProgressDetail = computed(() => resolveChatTopicProgressDetail(run.value))
const todayDayKey = dayjs().format('YYYY-MM-DD')

const rangeOptions = computed(() => [
  {
    value: 'current' as const,
    label: t('records.topics.range.current'),
    description: t('records.topics.range.currentDescription', { date: props.dayKey ?? '' }),
  },
  {
    value: 'custom' as const,
    label: t('records.topics.range.custom'),
    description: t('records.topics.range.customDescription'),
  },
  {
    value: 'today' as const,
    label: t('records.topics.range.today'),
    description: t('records.topics.range.todayDescription'),
  },
  {
    value: 'year' as const,
    label: t('records.topics.range.year'),
    description: t('records.topics.range.yearDescription'),
  },
  {
    value: 'all' as const,
    label: t('records.topics.range.all'),
    description: t('records.topics.range.allDescription'),
  },
])

async function loadPanel() {
  const version = ++loadVersion
  clearPollTimer()
  if (!props.dayKey) {
    day.value = null
    return
  }
  loading.value = true
  try {
    const service = useChatTopicsService()
    const [nextDay, latestRun] = await Promise.all([
      service.getDay(props.sessionId, props.dayKey, timezone),
      service.getLatestRun(props.sessionId),
    ])
    if (version !== loadVersion) return
    day.value = nextDay
    run.value = latestRun
    schedulePoll()
  } catch (error) {
    if (version !== loadVersion) return
    toast.fail(t('records.topics.loadFailed'), { description: errorMessage(error) })
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

async function refreshRun() {
  if (!run.value) return
  try {
    const next = await useChatTopicsService().getRun(props.sessionId, run.value.id)
    const statusChanged = next.status !== run.value.status || next.completedDays !== run.value.completedDays
    run.value = next
    if (statusChanged && props.dayKey) {
      const nextDay = await useChatTopicsService().getDay(props.sessionId, props.dayKey, timezone)
      if (shouldClearChatTopicHighlight(day.value, nextDay)) clearTopicSelection()
      day.value = nextDay
    }
    schedulePoll()
  } catch {
    clearPollTimer()
  }
}

function schedulePoll() {
  clearPollTimer()
  if (run.value && ['pending', 'running'].includes(run.value.status)) {
    pollTimer = setTimeout(() => void refreshRun(), 800)
  }
}

function clearPollTimer() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function openCreate() {
  selectedRange.value = props.dayKey ? 'current' : 'today'
  customStartDay.value = props.dayKey ?? todayDayKey
  showCreateModal.value = true
  await loadPreflight()
}

function buildCreateRequest(): CreateChatTopicsRequest | null {
  const rangeKind = selectedRange.value === 'current' ? 'custom' : selectedRange.value
  const startDay =
    rangeKind === 'custom' ? (selectedRange.value === 'current' ? props.dayKey : customStartDay.value) : undefined
  if (rangeKind === 'custom' && !startDay) return null
  return { rangeKind, startDay: startDay ?? undefined, timezone, locale: locale.value }
}

async function loadPreflight() {
  if (!showCreateModal.value) return
  const version = ++preflightVersion
  const request = buildCreateRequest()
  if (!request) {
    preflight.value = null
    preflightLoading.value = false
    return
  }
  preflightLoading.value = true
  try {
    const result = await useChatTopicsService().preflight(props.sessionId, request)
    if (version !== preflightVersion) return
    preflight.value = result
  } catch (error) {
    if (version !== preflightVersion) return
    preflight.value = null
    toast.fail(t('records.topics.preflightFailed'), { description: errorMessage(error) })
  } finally {
    if (version === preflightVersion) preflightLoading.value = false
  }
}

async function startGeneration() {
  const request = buildCreateRequest()
  if (!request || !preflight.value || preflight.value.activeDays === 0) return
  actionLoading.value = true
  try {
    run.value = await useChatTopicsService().start(props.sessionId, request)
    showCreateModal.value = false
    schedulePoll()
  } catch (error) {
    toast.fail(t('records.topics.startFailed'), { description: errorMessage(error) })
  } finally {
    actionLoading.value = false
  }
}

async function regenerateDay() {
  if (!props.dayKey) return
  actionLoading.value = true
  try {
    run.value = await useChatTopicsService().generateDay(props.sessionId, props.dayKey, timezone, locale.value)
    clearTopicSelection()
    schedulePoll()
  } catch (error) {
    toast.fail(t('records.topics.startFailed'), { description: errorMessage(error) })
  } finally {
    actionLoading.value = false
  }
}

async function runAction(action: 'pause' | 'resume' | 'cancel') {
  if (!run.value) return
  actionLoading.value = true
  try {
    run.value = await useChatTopicsService()[action](props.sessionId, run.value.id)
    schedulePoll()
  } catch (error) {
    toast.fail(t('records.topics.actionFailed'), { description: errorMessage(error) })
  } finally {
    actionLoading.value = false
  }
}

async function deleteCurrentDay() {
  if (!props.dayKey) return
  actionLoading.value = true
  try {
    await useChatTopicsService().deleteDay(props.sessionId, props.dayKey)
    day.value = null
    clearTopicSelection()
    showDeleteModal.value = false
  } catch (error) {
    toast.fail(t('records.topics.deleteFailed'), { description: errorMessage(error) })
  } finally {
    actionLoading.value = false
  }
}

function formatTime(timestamp: number): string {
  return dayjs.unix(timestamp).format('HH:mm')
}

function formatRange(startTs: number, endTs: number): string {
  const start = formatTime(startTs)
  const end = formatTime(endTs)
  return start === end ? start : `${start}–${end}`
}

function toggleTopicEvidence(topicId: string) {
  expandedEvidenceTopicId.value = expandedEvidenceTopicId.value === topicId ? null : topicId
}

function selectTopic(topic: ChatTopic) {
  const isSelected = selectedTopicId.value === topic.id
  selectedTopicId.value = isSelected ? null : topic.id
  emit('highlight-topic', isSelected ? null : buildTopicHighlight(topic))
  const firstMessageId = topic.messageIds?.[0] ?? topic.evidence[0]?.messageId
  if (!isSelected && firstMessageId !== undefined) emit('jump-to-message', firstMessageId)
}

function jumpToEvidence(topic: ChatTopic, messageId: number) {
  selectedTopicId.value = topic.id
  emit('highlight-topic', buildTopicHighlight(topic))
  emit('jump-to-message', messageId)
}

function buildTopicHighlight(topic: ChatTopic): ChatTopicHighlight {
  return {
    messageIds: [...(topic.messageIds ?? [])],
    timeRanges: topic.timeRanges.map((range) => ({ ...range })),
    assignmentMode: topic.assignmentMode === 'exact' ? 'exact' : 'range',
    colorIndex: topicColorIndex(topic),
  }
}

function topicColorIndex(topic: ChatTopic): number {
  const index = day.value?.topics.findIndex((item) => item.id === topic.id) ?? 0
  return Math.max(0, index) % CHAT_TOPIC_COLOR_STYLES.length
}

function topicColor(topic: ChatTopic) {
  return chatTopicColorStyle(topicColorIndex(topic))
}

function clearTopicSelection() {
  selectedTopicId.value = null
  expandedEvidenceTopicId.value = null
  emit('highlight-topic', null)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

watch(
  () => [props.sessionId, props.dayKey],
  () => {
    clearTopicSelection()
    void loadPanel()
  },
  { immediate: true }
)
watch([selectedRange, customStartDay, () => props.dayKey], () => void loadPreflight())
onUnmounted(() => {
  clearPollTimer()
  emit('highlight-topic', null)
})
</script>

<template>
  <aside
    v-if="collapsed"
    class="flex h-full w-10 shrink-0 flex-col items-center border-l border-gray-200 bg-gray-50 py-2 dark:border-gray-700 dark:bg-page-dark/50"
  >
    <UButton icon="i-heroicons-chevron-left" variant="ghost" size="xs" @click="collapsed = false" />
    <div class="mt-2 flex flex-1 items-center">
      <span class="vertical-text text-xs text-gray-400">{{ t('records.topics.title') }}</span>
    </div>
  </aside>

  <aside
    v-else
    class="flex h-full w-72 shrink-0 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-page-dark/50 xl:w-80"
  >
    <header class="flex h-9 shrink-0 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-700">
      <div class="min-w-0">
        <span class="text-xs font-medium text-gray-700 dark:text-gray-200">{{ t('records.topics.title') }}</span>
        <span v-if="dayKey" class="ml-2 text-[11px] text-gray-400">{{ dayKey }}</span>
      </div>
      <div class="flex items-center gap-0.5">
        <UButton
          v-if="day"
          icon="i-heroicons-trash"
          color="neutral"
          variant="ghost"
          size="xs"
          :title="t('common.delete')"
          @click="showDeleteModal = true"
        />
        <UButton icon="i-heroicons-chevron-right" variant="ghost" size="xs" @click="collapsed = true" />
      </div>
    </header>

    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-gray-400" />
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-3">
      <section
        v-if="run && (activeRun || resumableRun)"
        class="mb-3 rounded-xl border border-pink-200/70 bg-white p-3 dark:border-pink-900/60 dark:bg-gray-900/50"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
            <UIcon
              :name="activeRun ? 'i-heroicons-arrow-path' : 'i-heroicons-pause-circle'"
              class="h-4 w-4 shrink-0 text-pink-500"
              :class="{ 'animate-spin': activeRun }"
            />
            <span class="truncate">{{ t(`records.topics.status.${run.status}`) }}</span>
          </div>
          <span class="text-[11px] tabular-nums text-gray-400">{{ progressPercent }}%</span>
        </div>
        <UProgress class="mt-2" :value="progressPercent" size="xs" />
        <p v-if="activeProgressDetail" class="mt-2 text-[11px] text-pink-500 dark:text-pink-300">
          {{ t(activeProgressDetail.key, activeProgressDetail.params) }}
        </p>
        <p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          {{ t('records.topics.progress', { completed: run.completedDays, total: run.totalDays }) }}
        </p>
        <p v-if="run.lastError" class="mt-1 line-clamp-2 text-[11px] text-red-500">{{ run.lastError }}</p>
        <div class="mt-2 flex gap-1.5">
          <UButton
            v-if="activeRun"
            size="xs"
            color="neutral"
            variant="soft"
            :disabled="actionLoading"
            @click="runAction('pause')"
          >
            {{ t('records.topics.pause') }}
          </UButton>
          <UButton
            v-if="resumableRun"
            size="xs"
            color="primary"
            variant="soft"
            :loading="actionLoading"
            @click="runAction('resume')"
          >
            {{ t('records.topics.resume') }}
          </UButton>
          <UButton size="xs" color="neutral" variant="ghost" :disabled="actionLoading" @click="runAction('cancel')">
            {{ t('common.cancel') }}
          </UButton>
        </div>
      </section>

      <template v-if="day">
        <div
          v-if="day.status === 'stale'"
          class="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{{ t('records.topics.stale') }}</span>
        </div>

        <p v-if="day.overview" class="mb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
          {{ day.overview }}
        </p>

        <div class="space-y-2">
          <article
            v-for="topic in day.topics"
            :key="topic.id"
            role="button"
            tabindex="0"
            :aria-pressed="selectedTopicId === topic.id"
            :data-topic-color="topicColorIndex(topic)"
            class="cursor-pointer rounded-xl border bg-white p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pink-400/70 dark:bg-gray-900/50"
            :class="
              selectedTopicId === topic.id
                ? topicColor(topic).selectedCard
                : 'border-gray-200 hover:border-pink-200 hover:bg-pink-50/20 dark:border-gray-700 dark:hover:border-pink-900 dark:hover:bg-pink-950/10'
            "
            @click="selectTopic(topic)"
            @keydown.enter.prevent="selectTopic(topic)"
            @keydown.space.prevent="selectTopic(topic)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex min-w-0 items-start gap-2">
                <span class="mt-1 h-2 w-2 shrink-0 rounded-full" :class="topicColor(topic).dot" />
                <h3 class="text-xs font-semibold leading-snug text-gray-800 dark:text-gray-100">
                  {{ topic.title }}
                </h3>
              </div>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                :class="
                  topic.state === 'active'
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                "
              >
                {{ t(`records.topics.topicState.${topic.state}`) }}
              </span>
            </div>
            <p class="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ topic.summary }}</p>
            <div v-if="topic.timeRanges.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="range in topic.timeRanges"
                :key="`${range.startTs}-${range.endTs}`"
                class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              >
                {{ formatRange(range.startTs, range.endTs) }}
              </span>
            </div>
            <p v-if="topic.participants.length" class="mt-2 truncate text-[10px] text-gray-400">
              {{ topic.participants.slice(0, 4).join(' · ') }}
            </p>
            <div
              v-if="topic.evidence.length"
              class="mt-2 flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2 dark:border-gray-800"
            >
              <span class="mr-0.5 text-[10px] text-gray-400">{{ t('records.topics.evidence') }}</span>
              <button
                v-for="evidence in topic.evidence.slice(
                  0,
                  expandedEvidenceTopicId === topic.id ? topic.evidence.length : 3
                )"
                :key="evidence.messageId"
                class="rounded px-1.5 py-0.5 text-[10px] tabular-nums hover:bg-gray-100 dark:hover:bg-gray-800"
                :class="topicColor(topic).text"
                @click.stop="jumpToEvidence(topic, evidence.messageId)"
              >
                {{ formatTime(evidence.timestamp) }}
              </button>
              <button
                v-if="topic.evidence.length > 3 && expandedEvidenceTopicId !== topic.id"
                class="rounded px-1 py-0.5 text-[10px] text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                @click.stop="toggleTopicEvidence(topic.id)"
              >
                +{{ topic.evidence.length - 3 }}
              </button>
              <button
                v-else-if="topic.evidence.length > 3"
                class="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                @click.stop="toggleTopicEvidence(topic.id)"
              >
                <UIcon name="i-heroicons-chevron-up" class="h-3 w-3" />
              </button>
            </div>
          </article>
        </div>

        <div class="mt-3 flex gap-2">
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            icon="i-heroicons-arrow-path"
            :loading="actionLoading"
            :disabled="Boolean(activeRun)"
            @click="regenerateDay"
          >
            {{ t('records.topics.updateDay') }}
          </UButton>
          <UButton size="xs" color="neutral" variant="ghost" :disabled="Boolean(activeRun)" @click="openCreate">
            {{ t('records.topics.backfill') }}
          </UButton>
        </div>
      </template>

      <div v-else class="flex min-h-64 flex-col items-center justify-center px-4 text-center">
        <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-pink-50 dark:bg-pink-950/30">
          <UIcon name="i-heroicons-hashtag" class="h-5 w-5 text-pink-500" />
        </div>
        <p class="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">{{ t('records.topics.emptyTitle') }}</p>
        <p class="mt-1.5 text-xs leading-relaxed text-gray-400">{{ t('records.topics.emptyDescription') }}</p>
        <UButton
          class="mt-4"
          size="sm"
          color="primary"
          icon="i-heroicons-sparkles"
          :disabled="Boolean(activeRun) || !dayKey"
          @click="openCreate"
        >
          {{ t('records.topics.create') }}
        </UButton>
      </div>
    </div>
  </aside>

  <UModal v-model:open="showCreateModal" :ui="{ content: 'sm:max-w-lg z-[10001]', overlay: 'z-[10000]' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-base font-semibold">{{ t('records.topics.createTitle') }}</h3>
              <p class="mt-0.5 text-xs text-gray-400">{{ t('records.topics.createDescription') }}</p>
            </div>
            <UButton
              icon="i-heroicons-x-mark"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="showCreateModal = false"
            />
          </div>
        </template>

        <div class="space-y-2">
          <div v-for="option in rangeOptions" :key="option.value">
            <button
              class="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors"
              :class="
                selectedRange === option.value
                  ? 'border-pink-400 bg-pink-50/60 dark:border-pink-700 dark:bg-pink-950/20'
                  : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50'
              "
              @click="selectedRange = option.value"
            >
              <span
                class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                :class="selectedRange === option.value ? 'border-pink-500' : 'border-gray-300 dark:border-gray-600'"
              >
                <span v-if="selectedRange === option.value" class="h-2 w-2 rounded-full bg-pink-500" />
              </span>
              <span>
                <span class="block text-sm font-medium text-gray-800 dark:text-gray-100">{{ option.label }}</span>
                <span class="mt-0.5 block text-xs text-gray-400">{{ option.description }}</span>
              </span>
            </button>
            <div v-if="option.value === 'custom' && selectedRange === 'custom'" class="px-3 pb-1 pt-2">
              <UInput v-model="customStartDay" type="date" :max="todayDayKey" class="w-full" />
            </div>
          </div>
        </div>

        <div class="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
          <div v-if="preflightLoading" class="flex h-10 items-center justify-center">
            <UIcon name="i-heroicons-arrow-path" class="h-4 w-4 animate-spin text-gray-400" />
          </div>
          <div v-else-if="preflight">
            <p v-if="preflight.activeDays > 0" class="mb-2 text-center text-[11px] text-gray-400">
              {{ t('records.topics.estimate.range', { start: preflight.startDay, end: preflight.endDay }) }}
            </p>
            <div class="grid grid-cols-3 gap-3 text-center">
              <div>
                <p class="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {{ preflight.activeDays }}
                </p>
                <p class="text-[11px] text-gray-400">{{ t('records.topics.estimate.days') }}</p>
              </div>
              <div>
                <p class="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {{ preflight.messageCount }}
                </p>
                <p class="text-[11px] text-gray-400">{{ t('records.topics.estimate.messages') }}</p>
              </div>
              <div>
                <p class="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {{ preflight.estimatedCalls }}
                </p>
                <p class="text-[11px] text-gray-400">{{ t('records.topics.estimate.calls') }}</p>
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="showCreateModal = false">{{ t('common.cancel') }}</UButton>
            <UButton
              color="primary"
              :loading="actionLoading"
              :disabled="preflightLoading || !preflight || preflight.activeDays === 0"
              @click="startGeneration"
            >
              {{ preflight?.activeDays === 0 ? t('records.topics.noMessages') : t('records.topics.start') }}
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="showDeleteModal" :ui="{ content: 'sm:max-w-md z-[10001]', overlay: 'z-[10000]' }">
    <template #content>
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold">{{ t('records.topics.deleteTitle') }}</h3>
        </template>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('records.topics.deleteDescription') }}</p>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="showDeleteModal = false">{{ t('common.cancel') }}</UButton>
            <UButton color="error" :loading="actionLoading" @click="deleteCurrentDay">{{ t('common.delete') }}</UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>

<style scoped>
.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
</style>
