<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import type { AIEntityRef } from '@openchatlab/shared-types'
import { getDefaultGeneralAssistantId } from '@openchatlab/shared-types'
import ConversationList from '@/components/AIChat/chat/ConversationList.vue'
import ChatMessage from '@/components/AIChat/chat/ChatMessage.vue'
import AIThinkingIndicator from '@/components/AIChat/chat/AIThinkingIndicator.vue'
import ChatStatusBar from '@/components/AIChat/chat/ChatStatusBar.vue'
import AIChatComposer from '@/components/AIChat/input/AIChatComposer.vue'
import { useChatScroll } from '@/components/AIChat/composables/useChatScroll'
import { useProgressiveChatHistory } from '@/components/AIChat/composables/useProgressiveChatHistory'
import { groupMessagesToQAPairs } from '@/components/AIChat/utils/chatMessages'
import PageHeader from '@/components/layout/PageHeader.vue'
import { useAIService } from '@/services'
import type { AIChat } from '@/services/ai/types'
import { useAIChatStore } from '@/stores/aiChat'
import { useLayoutStore } from '@/stores/layout'
import { useToast } from '@/composables/useToast'
import GlobalEntityPicker from './components/GlobalEntityPicker.vue'

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
const input = ref('')
const selectedEntities = ref<AIEntityRef[]>([])
const isComposing = ref(false)

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

async function selectConversation(aiChatId: string): Promise<void> {
  if (!(await aiChatStore.loadAIChat(chatKey, aiChatId))) {
    toast.fail(t('ai.global.toast.loadFailed'))
    return
  }
  selectedEntities.value = []
  await syncAIChatIdToRoute(aiChatId)
  await nextTick()
  scrollToBottom(true)
}

function startNewConversation(): void {
  if (!aiChatStore.startNewAIChat(chatKey)) return
  selectedEntities.value = []
  input.value = ''
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

async function submit(): Promise<void> {
  const content = input.value.trim()
  if (!content || isAIThinking.value) return

  const refs = selectedEntities.value.map((entity) => ({ ...entity }))
  input.value = ''
  selectedEntities.value = []
  const result = await aiChatStore.sendMessage(chatKey, content, { entityRefs: refs })
  if (result.success || result.reason === 'aborted') return

  if (result.reason === 'no_config') {
    input.value = content
    selectedEntities.value = refs
    layoutStore.openSettings('ai', 'defaultModel')
    return
  }
  if (result.reason === 'busy') {
    toast.warn(t('ai.global.toast.busy'))
    return
  }
  input.value = content
  selectedEntities.value = refs
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || isComposing.value) return
  event.preventDefault()
  void submit()
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
  const preferredAIChatId = typeof route.query.aiChatId === 'string' ? route.query.aiChatId : null
  if (!preferredAIChatId || !(await aiChatStore.loadAIChat(chatKey, preferredAIChatId))) {
    aiChatStore.startNewAIChat(chatKey)
    if (preferredAIChatId) await syncAIChatIdToRoute(null)
  }
  initializing.value = false
  await syncAIChatIdToRoute(currentAIChatId.value)
  await nextTick()
  scrollToBottom(true)
})
</script>

<template>
  <div
    class="flex h-full min-w-0 flex-col bg-page-bg text-gray-900 dark:bg-page-dark dark:text-gray-100"
    style="padding-top: var(--titlebar-area-height)"
  >
    <PageHeader
      :title="t('ai.global.title')"
      :description="t('ai.global.subtitle')"
      icon="i-heroicons-sparkles"
      icon-class="bg-primary-600 text-white dark:bg-primary-500 dark:text-white"
      size="compact"
    />

    <div class="flex min-h-0 min-w-0 flex-1">
      <ConversationList
        session-id=""
        :active-id="currentAIChatId"
        :conversations="conversations"
        :loading="conversationsLoading"
        :disabled="isAIThinking"
        embedded
        @select="selectConversation"
        @create="startNewConversation"
        @rename="renameConversation"
        @delete="deleteConversation"
      />

      <section class="flex min-w-0 flex-1 flex-col border-l border-gray-200 dark:border-gray-800">
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
            class="mx-auto max-w-3xl overflow-visible rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.04)] ring-1 ring-gray-200/60 transition-all focus-within:ring-primary-500/40 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:bg-page-dark dark:ring-white/5"
          >
            <div class="border-b border-gray-100 px-3 py-2 dark:border-gray-800/80">
              <GlobalEntityPicker v-model="selectedEntities" :disabled="isAIThinking" />
            </div>
            <AIChatComposer
              v-model="input"
              embedded
              :disabled="isAIThinking"
              :status="isAIThinking ? 'streaming' : 'ready'"
              :placeholder="t('ai.global.input.placeholder')"
              :send-button-title="t('ai.chat.input.send')"
              @submit="submit"
              @stop="aiChatStore.stopGeneration(chatKey)"
              @keydown="handleKeydown"
              @composition-start="isComposing = true"
              @composition-end="isComposing = false"
            />
            <ChatStatusBar
              class="px-2 pb-1.5 pt-0.5"
              :session-token-usage="state.sessionTokenUsage"
              :agent-status="state.agentStatus"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
