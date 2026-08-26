<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import type { AIEntityRef } from '@openchatlab/shared-types'
import { getDefaultGeneralAssistantId } from '@openchatlab/shared-types'
import ConversationList from '@/components/AIChat/chat/ConversationList.vue'
import ChatHeaderActions from '@/components/AIChat/chat/ChatHeaderActions.vue'
import ChatMessage from '@/components/AIChat/chat/ChatMessage.vue'
import AIThinkingIndicator from '@/components/AIChat/chat/AIThinkingIndicator.vue'
import ChatStatusBar from '@/components/AIChat/chat/ChatStatusBar.vue'
import AIChatInput from '@/components/AIChat/input/AIChatInput.vue'
import AIMemoryManagerModal from '@/components/AIChat/memory/AIMemoryManagerModal.vue'
import { useChatScroll } from '@/components/AIChat/composables/useChatScroll'
import { useProgressiveChatHistory } from '@/components/AIChat/composables/useProgressiveChatHistory'
import { groupMessagesToQAPairs } from '@/components/AIChat/utils/chatMessages'
import PageHeader from '@/components/layout/PageHeader.vue'
import { useAIService } from '@/services'
import type { AIChat } from '@/services/ai/types'
import { useAIChatStore } from '@/stores/aiChat'
import { useLayoutStore } from '@/stores/layout'
import { useToast } from '@/composables/useToast'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const layoutStore = useLayoutStore()
const aiChatStore = useAIChatStore()
const aiService = useAIService()
const { chatKey, state } = aiChatStore.ensureGlobalState(locale.value)
const messages = toRef(state, 'messages')
const isAIThinking = toRef(state, 'isAIThinking')
const currentAIChatId = toRef(state, 'currentAIChatId')
const conversations = ref<AIChat[]>([])
const conversationsLoading = ref(false)
const initializing = ref(true)
const chatInputRef = ref<{ clearDraft: () => void } | null>(null)
let isUnmounted = false
let conversationSelectionRequestId = 0
let contextEstimateRequestId = 0
let sourceHighlightTimer: ReturnType<typeof setTimeout> | null = null

function isGlobalPageActive(): boolean {
  return !isUnmounted && route.name === 'global-ai'
}
const estimatedContextTokens = ref(0)
const showMemoryManager = ref(false)
const highlightedSourceMessageId = ref<string | null>(null)

const pairs = computed(() => groupMessagesToQAPairs(messages.value))
const { messagesContainer, showScrollToBottom, handleScrollToBottom, scrollToBottom } = useChatScroll(
  messages,
  isAIThinking
)
const { visiblePairs, hasOlderPairs, loadOlderPairs } = useProgressiveChatHistory(
  pairs,
  currentAIChatId,
  messagesContainer
)

async function syncAIChatIdToRoute(aiChatId: string | null): Promise<void> {
  if (!isGlobalPageActive()) return

  const routeAIChatId = typeof route.query.aiChatId === 'string' ? route.query.aiChatId : null
  if (routeAIChatId === aiChatId) return

  await router.replace({
    query: {
      ...route.query,
      aiChatId: aiChatId || undefined,
    },
  })
}

async function loadConversations(): Promise<void> {
  conversationsLoading.value = true
  try {
    conversations.value = await aiService.getGlobalAIChats()
  } catch (error) {
    toast.fail(t('ai.global.toast.loadFailed'), { description: String(error) })
  } finally {
    conversationsLoading.value = false
  }
}

async function selectConversation(aiChatId: string, sourceMessageId: string | null = null): Promise<void> {
  const currentRequest = ++conversationSelectionRequestId
  const loaded = await aiChatStore.loadAIChat(chatKey, aiChatId)
  if (currentRequest !== conversationSelectionRequestId || !isGlobalPageActive()) return

  if (!loaded) {
    toast.fail(t('ai.global.toast.loadFailed'))
    return
  }
  initializing.value = false
  await syncAIChatIdToRoute(aiChatId)
  if (currentRequest !== conversationSelectionRequestId || !isGlobalPageActive()) return
  await nextTick()
  if (sourceMessageId) {
    await revealSourceMessage(sourceMessageId)
  } else {
    highlightedSourceMessageId.value = null
    scrollToBottom(true)
  }
}

async function revealSourceMessage(messageId: string): Promise<void> {
  const targetExists = pairs.value.some(
    (pair) => pair.user?.id === messageId || pair.assistant?.id === messageId || pair.standalone?.id === messageId
  )
  if (!targetExists) {
    toast.warn(t('ai.global.memory.sourceUnavailable'))
    return
  }

  while (
    hasOlderPairs.value &&
    !visiblePairs.value.some(
      (pair) => pair.user?.id === messageId || pair.assistant?.id === messageId || pair.standalone?.id === messageId
    )
  ) {
    await loadOlderPairs()
  }

  highlightedSourceMessageId.value = messageId
  await nextTick()
  const element = messagesContainer.value?.querySelector<HTMLElement>(`[data-ai-message-id="${CSS.escape(messageId)}"]`)
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (sourceHighlightTimer) clearTimeout(sourceHighlightTimer)
  sourceHighlightTimer = setTimeout(() => {
    if (highlightedSourceMessageId.value === messageId) highlightedSourceMessageId.value = null
  }, 4000)
}

async function handleViewMemorySource(payload: { aiChatId: string; messageId: string | null }): Promise<void> {
  await selectConversation(payload.aiChatId, payload.messageId)
}

function startNewConversation(): void {
  conversationSelectionRequestId++
  if (!aiChatStore.startNewAIChat(chatKey)) return
  chatInputRef.value?.clearDraft()
  initializing.value = false
  void syncAIChatIdToRoute(null)
}

async function renameConversation(payload: { id: string; title: string }): Promise<void> {
  try {
    await aiService.updateAIChatTitle(payload.id, payload.title)
    const conversation = conversations.value.find((item) => item.id === payload.id)
    if (conversation) conversation.title = payload.title
  } catch (error) {
    toast.fail(t('ai.global.toast.renameFailed'), { description: String(error) })
  }
}

async function deleteConversation(aiChatId: string): Promise<void> {
  try {
    await aiService.deleteAIChat(aiChatId)
    conversations.value = conversations.value.filter((item) => item.id !== aiChatId)
    if (currentAIChatId.value === aiChatId) startNewConversation()
  } catch (error) {
    toast.fail(t('ai.global.toast.deleteFailed'), { description: String(error) })
  }
}

async function handleSend(payload: {
  content: string
  entityRefs: AIEntityRef[]
  onAccepted: () => void
}): Promise<void> {
  const result = await aiChatStore.sendMessage(chatKey, payload.content, {
    entityRefs: payload.entityRefs,
    onAccepted: payload.onAccepted,
  })
  if (result.success) {
    scrollToBottom(true)
    await loadConversations()
    return
  }
  if (result.reason === 'aborted') return

  if (result.reason === 'no_config') {
    layoutStore.openSettings('ai', 'defaultModel')
    return
  }
  if (result.reason === 'busy') {
    toast.warn(t('ai.global.toast.busy'))
  }
}

watch(locale, (nextLocale) => {
  aiChatStore.ensureGlobalState(nextLocale)
})

watch(currentAIChatId, (aiChatId, previousId) => {
  if (aiChatId === previousId) return
  if (!initializing.value) void syncAIChatIdToRoute(aiChatId)
  if (aiChatId) void loadConversations()
})

watch(
  currentAIChatId,
  async (aiChatId) => {
    const requestId = ++contextEstimateRequestId
    if (!aiChatId) {
      estimatedContextTokens.value = 0
      return
    }
    try {
      const result = await aiService.estimateContextTokens(aiChatId)
      if (requestId !== contextEstimateRequestId || currentAIChatId.value !== aiChatId) return
      estimatedContextTokens.value = result.success ? result.tokens : 0
    } catch {
      if (requestId !== contextEstimateRequestId || currentAIChatId.value !== aiChatId) return
      estimatedContextTokens.value = 0
    }
  },
  { immediate: true }
)

watch(
  () => route.query.aiChatId,
  (value) => {
    const aiChatId = typeof value === 'string' ? value : null
    if (initializing.value || isAIThinking.value) return
    if (!aiChatId) {
      if (currentAIChatId.value) aiChatStore.startNewAIChat(chatKey)
      return
    }
    if (aiChatId !== currentAIChatId.value) void selectConversation(aiChatId)
  }
)

onMounted(async () => {
  aiChatStore.selectAssistantForSession(chatKey, getDefaultGeneralAssistantId(locale.value))
  await loadConversations()
  if (!isGlobalPageActive()) return

  const currentSelectionRequest = ++conversationSelectionRequestId
  const preferredAIChatId = typeof route.query.aiChatId === 'string' ? route.query.aiChatId : null
  let restored = preferredAIChatId ? await aiChatStore.loadAIChat(chatKey, preferredAIChatId) : false
  if (currentSelectionRequest !== conversationSelectionRequestId || !isGlobalPageActive()) return

  const latestAIChatId = conversations.value[0]?.id
  if (!restored && latestAIChatId && latestAIChatId !== preferredAIChatId) {
    restored = await aiChatStore.loadAIChat(chatKey, latestAIChatId)
    if (currentSelectionRequest !== conversationSelectionRequestId || !isGlobalPageActive()) return
  }
  if (!restored) {
    aiChatStore.startNewAIChat(chatKey)
  }
  if (!isGlobalPageActive()) return

  initializing.value = false
  await syncAIChatIdToRoute(currentAIChatId.value)
  if (!isGlobalPageActive()) return

  await nextTick()
  if (!isGlobalPageActive()) return
  scrollToBottom(true)
})

onUnmounted(() => {
  isUnmounted = true
  conversationSelectionRequestId++
  contextEstimateRequestId++
  if (sourceHighlightTimer) clearTimeout(sourceHighlightTimer)
})
</script>

<template>
  <div class="flex h-full min-w-0 flex-col dark:bg-page-dark" style="padding-top: var(--titlebar-area-height)">
    <PageHeader
      :title="t('ai.global.title')"
      :description="t('ai.global.subtitle')"
      icon="i-heroicons-sparkles"
      icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
      size="compact"
    >
      <template #actions>
        <button
          type="button"
          class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          :aria-expanded="showMemoryManager"
          @click="showMemoryManager = true"
        >
          <UIcon name="i-lucide-brain" class="h-3.5 w-3.5" />
          <span>{{ t('ai.global.memory.button') }}</span>
        </button>
        <ChatHeaderActions
          :current-ai-chat-id="currentAIChatId"
          :current-messages="messages"
          :fallback-title="t('ai.global.title')"
        />
      </template>
    </PageHeader>

    <div class="main-content flex min-h-0 flex-1 overflow-hidden">
      <ConversationList
        session-id=""
        :active-id="currentAIChatId"
        :conversations="conversations"
        :loading="conversationsLoading"
        :disabled="isAIThinking"
        @select="selectConversation"
        @create="startNewConversation"
        @rename="renameConversation"
        @delete="deleteConversation"
      />

      <section class="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div class="relative min-h-0 flex-1">
          <div ref="messagesContainer" class="absolute inset-0 overflow-y-auto px-5 py-6">
            <div v-if="initializing" class="flex h-full items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="h-5 w-5 animate-spin text-gray-400" />
            </div>

            <div
              v-else-if="messages.length === 0"
              class="mx-auto flex h-full max-w-lg flex-col items-center justify-center pb-16 text-center"
            >
              <div
                class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-500 dark:bg-primary-500/10 dark:text-primary-300"
              >
                <UIcon name="i-heroicons-chat-bubble-left-right" class="h-6 w-6" />
              </div>
              <h2 class="text-base text-gray-800 dark:text-gray-100">{{ t('ai.global.empty.title') }}</h2>
              <p class="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {{ t('ai.global.empty.description') }}
              </p>
            </div>

            <div v-else class="mx-auto max-w-3xl space-y-4">
              <div v-if="hasOlderPairs" class="flex justify-center pb-2">
                <button
                  type="button"
                  class="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  @click="loadOlderPairs"
                >
                  <UIcon name="i-heroicons-arrow-up" class="h-3.5 w-3.5" />
                  {{ t('ai.chat.history.loadEarlier') }}
                </button>
              </div>

              <template v-for="pair in visiblePairs" :key="pair.id">
                <ChatMessage
                  v-if="pair.standalone"
                  :role="pair.standalone.role"
                  :content="pair.standalone.content"
                  :timestamp="pair.standalone.timestamp"
                />
                <div v-else class="qa-pair space-y-6 pb-4">
                  <ChatMessage
                    v-if="pair.user"
                    :role="pair.user.role"
                    :message-id="pair.user.id"
                    :content="pair.user.content"
                    :timestamp="pair.user.timestamp"
                    :entity-refs="pair.user.entityRefs"
                    :highlighted="highlightedSourceMessageId === pair.user.id"
                  />
                  <ChatMessage
                    v-if="
                      pair.assistant &&
                      (pair.assistant.content || pair.assistant.contentBlocks?.length || !pair.assistant.isStreaming)
                    "
                    :role="pair.assistant.role"
                    :message-id="pair.assistant.id"
                    :content="pair.assistant.content"
                    :timestamp="pair.assistant.timestamp"
                    :is-streaming="pair.assistant.isStreaming"
                    :process-duration-ms="pair.assistant.processDurationMs"
                    :content-blocks="pair.assistant.contentBlocks"
                    :show-capture-button="!pair.assistant.isStreaming"
                    :active-tool="pair.assistant.isStreaming ? state.currentToolStatus : null"
                    :highlighted="highlightedSourceMessageId === pair.assistant.id"
                  />
                  <AIThinkingIndicator
                    v-else-if="pair.assistant?.isStreaming"
                    :current-tool-status="state.currentToolStatus"
                    :agent-status="state.agentStatus"
                  />
                </div>
              </template>
            </div>
          </div>

          <Transition name="fade-up">
            <button
              v-if="showScrollToBottom"
              type="button"
              class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-800/90 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm hover:bg-gray-700 dark:bg-gray-700/90"
              @click="handleScrollToBottom"
            >
              <UIcon name="i-heroicons-arrow-down" class="h-3.5 w-3.5" />
              {{ t('ai.chat.scrollToBottom') }}
            </button>
          </Transition>
        </div>

        <div class="shrink-0 px-4 pb-4">
          <div
            class="relative mx-auto max-w-3xl overflow-visible rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.04)] ring-1 ring-gray-200/60 transition-all focus-within:ring-primary-500/40 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:bg-page-dark dark:ring-white/5"
          >
            <AIChatInput
              ref="chatInputRef"
              embedded
              :disabled="isAIThinking"
              :status="isAIThinking ? 'streaming' : 'ready'"
              mention-scope="global"
              :skills-enabled="false"
              :placeholder="t('ai.global.input.placeholder')"
              @send="handleSend"
              @stop="aiChatStore.stopGeneration(chatKey)"
            />
            <ChatStatusBar
              class="pb-1.5 pl-2 pr-[52px] pt-0.5"
              :session-token-usage="state.sessionTokenUsage"
              :agent-status="state.agentStatus"
              :estimated-context-tokens="estimatedContextTokens"
            />
          </div>
        </div>
      </section>
    </div>

    <AIMemoryManagerModal v-model:open="showMemoryManager" @view-source="handleViewMemorySource" />
  </div>
</template>
