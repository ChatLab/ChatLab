<script setup lang="ts">
/**
 * 聊天记录工作区
 *
 * Drawer 和“记忆 → 记录”共用同一套连续消息流、摘要时间线与左右滚动联动。
 */
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useToast } from '@/composables/useToast'
import { useSessionIndexService, type ChatSessionItem } from '@/services'
import { useSessionStore } from '@/stores/session'
import FilterPanel from './FilterPanel.vue'
import MessageList from './MessageList.vue'
import SessionTimeline from './SessionTimeline.vue'
import type { ChatRecordQuery } from './types'
import { preserveChatRecordSessionId, resolveChatRecordSessionId, scopeChatRecordQueryToSession } from './query-session'

const props = withDefaults(
  defineProps<{
    sessionId?: string | null
    initialQuery?: ChatRecordQuery | null
    active?: boolean
    mode?: 'drawer' | 'page'
  }>(),
  {
    initialQuery: null,
    active: true,
    mode: 'drawer',
  }
)

const { t } = useI18n()
const toast = useToast()
const sessionStore = useSessionStore()
const { currentSessionId } = storeToRefs(sessionStore)

const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const localQuery = ref<ChatRecordQuery>({})
const timelineCollapsed = ref(false)
const activeSessionId = ref<number | undefined>()
const sessionsCache = ref<ChatSessionItem[]>([])
const matchedSessionIds = ref<Set<number> | undefined>()
const indexState = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const isGeneratingIndex = ref(false)
const timelineVersion = ref(0)
let initializationVersion = 0

const isPageMode = computed(() => props.mode === 'page')
const fallbackSessionId = computed(() => props.sessionId || currentSessionId.value)
const effectiveSessionId = computed(() => resolveChatRecordSessionId(localQuery.value, fallbackSessionId.value))

function resetWorkspace() {
  localQuery.value = {}
  activeSessionId.value = undefined
  sessionsCache.value = []
  matchedSessionIds.value = undefined
  indexState.value = 'loading'
}

async function initializeWorkspace() {
  const version = ++initializationVersion

  if (!props.active) {
    resetWorkspace()
    return
  }

  const initialQuery = props.initialQuery ? { ...toRaw(props.initialQuery) } : {}
  const requestedSessionId = resolveChatRecordSessionId(initialQuery, fallbackSessionId.value)
  localQuery.value = requestedSessionId ? scopeChatRecordQueryToSession(initialQuery, requestedSessionId) : initialQuery
  activeSessionId.value = undefined
  sessionsCache.value = []
  matchedSessionIds.value = undefined
  indexState.value = 'loading'

  if (!requestedSessionId) {
    indexState.value = 'missing'
    return
  }

  try {
    const service = useSessionIndexService()
    const [stats, sessions] = await Promise.all([
      service.getStats(requestedSessionId),
      service.getSessions(requestedSessionId),
    ])
    if (version !== initializationVersion) return

    sessionsCache.value = sessions
    indexState.value = stats.hasIndex || sessions.length > 0 ? 'ready' : 'missing'
    activeSessionId.value = sessions[sessions.length - 1]?.id
  } catch (error) {
    if (version !== initializationVersion) return
    console.error('Failed to load chat record sessions:', error)
    indexState.value = 'error'
  }

  await nextTick()
  if (version === initializationVersion) {
    messageListRef.value?.refresh()
  }
}

function handleApplyFilter(query: ChatRecordQuery) {
  localQuery.value = preserveChatRecordSessionId(query, localQuery.value)
}

function handleResetFilter() {
  localQuery.value = preserveChatRecordSessionId({}, localQuery.value)
  matchedSessionIds.value = undefined
}

function handleMessageTimestampsChange(timestamps: number[]) {
  if (!localQuery.value.keywords?.length || !sessionsCache.value.length) {
    matchedSessionIds.value = undefined
    return
  }

  const sessionIds = new Set<number>()
  for (const ts of timestamps) {
    const session = sessionsCache.value.find((item) => ts >= item.startTs && ts <= item.endTs)
    if (session) sessionIds.add(session.id)
  }
  matchedSessionIds.value = sessionIds.size > 0 ? sessionIds : undefined
}

function handleVisibleMessageChange(payload: { id: number; timestamp: number }) {
  if (!sessionsCache.value.length) return

  let targetSession = sessionsCache.value.find(
    (session) => payload.timestamp >= session.startTs && payload.timestamp <= session.endTs
  )

  if (!targetSession) {
    for (const session of sessionsCache.value) {
      if (session.firstMessageId <= payload.id) targetSession = session
      else break
    }
  }

  if (targetSession && targetSession.id !== activeSessionId.value) {
    activeSessionId.value = targetSession.id
  }
}

function handleSessionSelect(segmentId: number, firstMessageId: number) {
  activeSessionId.value = segmentId
  localQuery.value = { ...localQuery.value, scrollToMessageId: firstMessageId }
}

function handleJumpToMessage(messageId: number) {
  localQuery.value = preserveChatRecordSessionId({ scrollToMessageId: messageId }, localQuery.value)
}

function handleSummaryUpdated(updatedSession: ChatSessionItem) {
  const index = sessionsCache.value.findIndex((session) => session.id === updatedSession.id)
  if (index !== -1) sessionsCache.value[index] = updatedSession
}

function handleSessionsUpdated(sessions: ChatSessionItem[]) {
  sessionsCache.value = sessions
  indexState.value = sessions.length > 0 ? 'ready' : 'missing'
}

async function generateIndex() {
  const sessionId = effectiveSessionId.value
  if (!sessionId || isGeneratingIndex.value) return

  isGeneratingIndex.value = true
  try {
    const count = await useSessionIndexService().generate(sessionId)
    toast.success(t('records.workspace.indexGenerated', { count }))
    timelineVersion.value++
    await initializeWorkspace()
  } catch (error) {
    toast.fail(t('records.workspace.indexGenerationFailed'), { description: String(error) })
  } finally {
    isGeneratingIndex.value = false
  }
}

watch([() => props.active, fallbackSessionId, () => props.initialQuery], () => initializeWorkspace(), {
  immediate: true,
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-page-dark"
      data-testid="chat-record-workspace"
    >
      <FilterPanel
        :query="localQuery"
        :session-id="effectiveSessionId || undefined"
        @apply="handleApplyFilter"
        @reset="handleResetFilter"
      />

      <div
        v-if="isPageMode && (indexState === 'missing' || indexState === 'error')"
        class="flex shrink-0 items-start justify-between gap-4 border-b border-amber-200/70 bg-amber-50/80 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/20"
      >
        <div class="flex min-w-0 gap-3">
          <UIcon name="i-heroicons-queue-list" class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
              {{ t('records.workspace.indexMissingTitle') }}
            </p>
            <p class="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              {{ t('records.workspace.indexMissingDescription') }}
            </p>
          </div>
        </div>
        <UButton
          class="shrink-0"
          color="warning"
          variant="soft"
          size="sm"
          icon="i-heroicons-bolt"
          :loading="isGeneratingIndex"
          @click="generateIndex"
        >
          {{ t('records.workspace.generateIndex') }}
        </UButton>
      </div>

      <div class="flex min-h-0 flex-1">
        <SessionTimeline
          v-if="effectiveSessionId"
          :key="`${effectiveSessionId}-${timelineVersion}`"
          v-model:collapsed="timelineCollapsed"
          :session-id="effectiveSessionId"
          :active-session-id="activeSessionId"
          :filter-start-ts="localQuery.startTs"
          :filter-end-ts="localQuery.endTs"
          :filter-matched-session-ids="matchedSessionIds"
          @select="handleSessionSelect"
          @summary-updated="handleSummaryUpdated"
          @sessions-updated="handleSessionsUpdated"
        />

        <div class="min-h-0 min-w-0 flex-1">
          <MessageList
            ref="messageListRef"
            :query="localQuery"
            @visible-message-change="handleVisibleMessageChange"
            @jump-to-message="handleJumpToMessage"
            @message-timestamps-change="handleMessageTimestampsChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
[data-testid='chat-record-workspace'] :deep(.chat-record-message-content),
[data-testid='chat-record-workspace'] :deep(.chat-record-message-content *) {
  -webkit-user-select: text;
  user-select: text;
}
</style>
