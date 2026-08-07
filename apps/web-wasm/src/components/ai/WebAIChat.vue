<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { FinishReason, RuntimeContentBlock, RuntimeMessage } from '@openchatlab/ai-runtime'
import { type AgentStreamEvent, type RuntimeConversation } from '@openchatlab/web-ai-runtime'
import ChatMessage from '@/components/AIChat/chat/ChatMessage.vue'
import ConversationList from '@/components/AIChat/chat/ConversationList.vue'
import SimpleAIChatInput from '@/components/AIChat/input/SimpleAIChatInput.vue'
import { reportRuntimeLog } from '@/services/log-report'
import { useLayoutStore } from '@/stores/layout'
import { toAIConversationListItem, toWebAIChatMessage } from './message-mapper'
import { isAbortError, resolveSendTarget } from './send-lifecycle'
import { useWebAISettingsStore } from '../../stores/web-ai-settings'

const props = defineProps<{
  sessionId: string
}>()

const { t, locale } = useI18n()
const layoutStore = useLayoutStore()
const webAISettings = useWebAISettingsStore()
const { config } = storeToRefs(webAISettings)
const runtime = webAISettings.getRuntime()
const conversations = ref<RuntimeConversation[]>([])
const conversationId = ref<string | null>(null)
const messages = ref<RuntimeMessage[]>([])
const streamingMessage = ref<RuntimeMessage | null>(null)
const generating = ref(false)
const loading = ref(true)
const errorText = ref('')
const processText = ref('')
const listOpen = ref(false)
const messagesContainer = ref<HTMLElement | null>(null)
const chatInputRef = ref<InstanceType<typeof SimpleAIChatInput> | null>(null)
let activeSendController: AbortController | null = null

const displayMessages = computed(() => {
  const result = messages.value.map((message) => toWebAIChatMessage(message))
  if (streamingMessage.value) result.push(toWebAIChatMessage(streamingMessage.value, true))
  return result
})
const conversationListItems = computed(() => conversations.value.map(toAIConversationListItem))
const canRetry = computed(() => messages.value.at(-1)?.role === 'user')
const canRegenerate = computed(() => messages.value.at(-1)?.role === 'assistant')

onMounted(async () => {
  try {
    await webAISettings.loadConfig()
    await loadConversations()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  activeSendController?.abort()
  if (conversationId.value) runtime.stop(conversationId.value)
})

watch(
  () => props.sessionId,
  async () => {
    if (generating.value) return
    conversationId.value = null
    messages.value = []
    await loadConversations()
  }
)

watch(displayMessages, () => void scrollToBottom(), { deep: true })

async function loadConversations(preferredId?: string) {
  conversations.value = await runtime.conversations.listConversations(props.sessionId)
  const nextId = preferredId ?? conversationId.value ?? conversations.value[0]?.id ?? null
  if (nextId && conversations.value.some((item) => item.id === nextId)) {
    await selectConversation(nextId)
  } else {
    conversationId.value = null
    messages.value = []
  }
}

async function selectConversation(id: string) {
  if (generating.value || id === conversationId.value) return
  conversationId.value = id
  messages.value = await runtime.conversations.getMessages(id)
  errorText.value = ''
  listOpen.value = false
}

function newConversation() {
  if (generating.value) return
  conversationId.value = null
  messages.value = []
  errorText.value = ''
  listOpen.value = false
}

async function deleteConversation(id: string) {
  if (generating.value || !window.confirm(t('webAI.conversations.deleteConfirm'))) return
  await runtime.conversations.deleteConversation(id)
  if (conversationId.value === id) conversationId.value = null
  await loadConversations()
}

async function renameConversation(payload: { id: string; title: string }) {
  if (generating.value) return
  await runtime.conversations.renameConversation(payload.id, payload.title)
  await loadConversations(payload.id)
}

async function ensureConversation(question: string, signal: AbortSignal): Promise<string> {
  if (conversationId.value) return conversationId.value
  const title = question.replace(/\s+/g, ' ').slice(0, 36)
  const conversation = await runtime.conversations.createConversation(props.sessionId, title, signal)
  // RPC mutations report committed results even if cancellation arrives immediately afterward. Keep the
  // empty conversation visible instead of racing navigation with a compensating delete.
  conversationId.value = conversation.id
  conversations.value = [conversation, ...conversations.value]
  return conversation.id
}

async function send(content: string) {
  const question = content.trim()
  if (!question || generating.value) return
  if (!config.value) {
    void nextTick(() => chatInputRef.value?.fillInput(question))
    layoutStore.openSettings('ai')
    return
  }
  errorText.value = ''
  processText.value = ''
  generating.value = true
  const sendController = new AbortController()
  activeSendController = sendController
  reportRuntimeLog({
    level: 'info',
    scope: 'web-ai',
    message: 'AI generation started',
    data: { sessionId: props.sessionId, conversationId: conversationId.value },
  })
  try {
    const id = await resolveSendTarget(sendController.signal, (signal) => ensureConversation(question, signal))
    messages.value.push({
      id: `optimistic-${Date.now()}`,
      conversationId: id,
      role: 'user',
      content: question,
      createdAt: Date.now(),
    })
    const result = await runtime.run({
      sessionId: props.sessionId,
      conversationId: id,
      locale: locale.value,
      userMessage: question,
      onEvent: handleEvent,
    })
    errorText.value = getFinishReasonWarning(result.finishReason)
    await refreshCurrentConversation()
    await loadConversationListOnly()
    reportRuntimeLog({
      level: 'info',
      scope: 'web-ai',
      message: 'AI generation finished',
      data: { sessionId: props.sessionId, conversationId: id, finishReason: result.finishReason },
    })
  } catch (error) {
    const aborted = isAbortError(error)
    if (!aborted) {
      errorText.value = getFriendlyError(error)
    }
    reportRuntimeLog({
      level: aborted ? 'info' : 'error',
      scope: 'web-ai',
      message: aborted ? 'AI generation aborted' : 'AI generation failed',
      data: { code: getErrorCode(error), aborted },
    })
    await refreshCurrentConversation()
  } finally {
    if (activeSendController === sendController) activeSendController = null
    generating.value = false
    streamingMessage.value = null
    processText.value = ''
  }
}

function stop() {
  const pendingSend = activeSendController
  if (pendingSend && !pendingSend.signal.aborted) pendingSend.abort()
  const generationStopped = conversationId.value ? runtime.stop(conversationId.value) : false
  if (pendingSend || generationStopped) {
    reportRuntimeLog({
      level: 'info',
      scope: 'web-ai',
      message: 'AI generation stopped',
      data: { sessionId: props.sessionId, conversationId: conversationId.value },
    })
  }
}

async function regenerate() {
  if (!conversationId.value || generating.value || !config.value) return
  const previousMessages = messages.value
  const latestAssistantIndex = messages.value.findLastIndex((message) => message.role === 'assistant')
  if (latestAssistantIndex >= 0) {
    messages.value = messages.value.filter((_, index) => index !== latestAssistantIndex)
  }
  generating.value = true
  errorText.value = ''
  try {
    const result = await runtime.regenerateLast({
      sessionId: props.sessionId,
      conversationId: conversationId.value,
      locale: locale.value,
      onEvent: handleEvent,
    })
    errorText.value = getFinishReasonWarning(result.finishReason)
  } catch (error) {
    messages.value = previousMessages
    if (!isAbortError(error)) errorText.value = getFriendlyError(error)
  } finally {
    generating.value = false
    streamingMessage.value = null
    processText.value = ''
    await refreshCurrentConversation()
  }
}

async function retry() {
  if (!conversationId.value || generating.value || !config.value || !canRetry.value) return
  generating.value = true
  errorText.value = ''
  processText.value = ''
  reportRuntimeLog({
    level: 'info',
    scope: 'web-ai',
    message: 'AI generation retry started',
    data: { sessionId: props.sessionId, conversationId: conversationId.value },
  })
  try {
    const result = await runtime.retryLast({
      sessionId: props.sessionId,
      conversationId: conversationId.value,
      locale: locale.value,
      onEvent: handleEvent,
    })
    errorText.value = getFinishReasonWarning(result.finishReason)
    await loadConversationListOnly()
    reportRuntimeLog({
      level: 'info',
      scope: 'web-ai',
      message: 'AI generation retry finished',
      data: {
        sessionId: props.sessionId,
        conversationId: conversationId.value,
        finishReason: result.finishReason,
      },
    })
  } catch (error) {
    const aborted = isAbortError(error)
    if (!aborted) errorText.value = getFriendlyError(error)
    reportRuntimeLog({
      level: aborted ? 'info' : 'error',
      scope: 'web-ai',
      message: aborted ? 'AI generation retry aborted' : 'AI generation retry failed',
      data: { code: getErrorCode(error), aborted },
    })
  } finally {
    generating.value = false
    streamingMessage.value = null
    processText.value = ''
    await refreshCurrentConversation()
  }
}

function handleEvent(event: AgentStreamEvent) {
  if (event.type === 'start') {
    streamingMessage.value = {
      id: event.messageId,
      conversationId: conversationId.value!,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      blocks: [],
    }
    return
  }
  if (event.type === 'context-compression-start') {
    processText.value = t('webAI.compressingContext')
    return
  }
  if (event.type === 'context-compression-finish') {
    processText.value = ''
    return
  }
  const message = streamingMessage.value
  if (!message) return
  if (event.type === 'text-delta') {
    message.content += event.delta
    appendTextBlock(message, 'text', event.delta)
  } else if (event.type === 'reasoning-delta') {
    appendTextBlock(message, 'reasoning', event.delta)
  } else if (event.type === 'tool-start') {
    message.blocks?.push({ type: 'tool', callId: event.callId, name: event.name, input: event.input })
    processText.value = t('webAI.usingTool', { name: event.name })
  } else if (event.type === 'tool-result') {
    const block = message.blocks?.find((item) => item.type === 'tool' && item.callId === event.callId) as
      | Extract<RuntimeContentBlock, { type: 'tool' }>
      | undefined
    if (block) {
      block.result = event.result
      block.isError = event.isError
    }
  } else if (event.type === 'evidence') {
    message.blocks?.push({ type: 'evidence', payload: event.payload })
  }
}

function appendTextBlock(message: RuntimeMessage, type: 'text' | 'reasoning', delta: string) {
  const last = message.blocks?.at(-1)
  if (last?.type === type) last.text += delta
  else message.blocks?.push({ type, text: delta })
}

async function refreshCurrentConversation() {
  if (conversationId.value) messages.value = await runtime.conversations.getMessages(conversationId.value)
}

async function loadConversationListOnly() {
  conversations.value = await runtime.conversations.listConversations(props.sessionId)
}

function getFriendlyError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const code = (error as { data?: { code?: string } }).data?.code
    if (code && ['AUTH', 'RATE_LIMIT', 'MODEL_NOT_FOUND', 'TIMEOUT', 'NETWORK_OR_CORS'].includes(code)) {
      return t(`webAI.errors.${code}`)
    }
  }
  return error instanceof Error ? error.message : String(error)
}

function getFinishReasonWarning(reason: FinishReason): string {
  if (reason === 'length') return t('webAI.errors.FINISH_LENGTH')
  if (reason === 'content-filter') return t('webAI.errors.FINISH_CONTENT_FILTER')
  if (reason === 'tool-calls') return t('webAI.errors.FINISH_TOOL_CALLS')
  if (reason === 'unknown' || reason === 'error') return t('webAI.errors.FINISH_UNKNOWN')
  return ''
}

function getErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    return String((error as { data?: { code?: unknown } }).data?.code ?? 'UNKNOWN')
  }
  return isAbortError(error) ? 'ABORTED' : 'UNKNOWN'
}

async function scrollToBottom() {
  await nextTick()
  messagesContainer.value?.scrollTo({ top: messagesContainer.value.scrollHeight, behavior: 'smooth' })
}

function handleSend(payload: { content: string }) {
  void send(payload.content)
}
</script>

<template>
  <div class="relative flex h-full min-h-0 overflow-hidden bg-white/40 dark:bg-page-dark">
    <button
      v-if="listOpen"
      type="button"
      class="absolute inset-0 z-20 bg-black/20 md:hidden"
      :aria-label="t('common.close')"
      @click="listOpen = false"
    />
    <aside
      class="absolute inset-y-0 left-0 z-30 transition-transform md:hidden"
      :class="listOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <ConversationList
        :session-id="sessionId"
        :active-id="conversationId"
        :disabled="generating"
        :conversations="conversationListItems"
        :loading="loading"
        :collapsible="false"
        embedded
        @select="selectConversation"
        @create="newConversation"
        @delete="deleteConversation"
        @rename="renameConversation"
      />
    </aside>

    <div class="hidden h-full md:block">
      <ConversationList
        :session-id="sessionId"
        :active-id="conversationId"
        :disabled="generating"
        :conversations="conversationListItems"
        :loading="loading"
        @select="selectConversation"
        @create="newConversation"
        @delete="deleteConversation"
        @rename="renameConversation"
      />
    </div>

    <section class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800/70">
        <UButton
          icon="i-heroicons-bars-3"
          size="sm"
          color="neutral"
          variant="ghost"
          class="md:hidden"
          :aria-label="t('webAI.conversations.title')"
          @click="listOpen = true"
        />
        <div class="flex min-w-0 items-center gap-2">
          <UIcon name="i-heroicons-sparkles" class="h-4 w-4 shrink-0 text-primary-500" />
          <span class="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
            {{ t('webAI.title') }}
          </span>
        </div>
        <span v-if="processText" class="ml-auto truncate text-xs text-gray-400">{{ processText }}</span>
        <UButton
          icon="i-heroicons-cog-6-tooth"
          size="sm"
          color="neutral"
          variant="ghost"
          class="ml-auto"
          :aria-label="t('webAI.config.title')"
          @click="layoutStore.openSettings('ai')"
        />
      </div>

      <div ref="messagesContainer" class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-5 sm:px-5">
        <div v-if="loading" class="flex h-full items-center justify-center">
          <UIcon name="i-heroicons-arrow-path" class="h-5 w-5 animate-spin text-primary-500" />
        </div>
        <div
          v-else-if="displayMessages.length === 0"
          class="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-3 pb-24 text-center"
        >
          <h2 class="text-2xl font-semibold tracking-tight text-gray-800 dark:text-gray-100">
            {{ t('webAI.emptyTitle') }}
          </h2>
          <p class="mt-3 max-w-lg text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {{ t('webAI.emptyDescription') }}
          </p>
        </div>
        <div v-else class="mx-auto max-w-3xl space-y-6 px-1 sm:px-4">
          <ChatMessage
            v-for="message in displayMessages"
            :key="message.id"
            :message-id="message.id"
            :role="message.role"
            :content="message.content"
            :timestamp="message.timestamp"
            :content-blocks="message.contentBlocks"
            :is-streaming="message.isStreaming"
          />
        </div>
      </div>

      <div class="shrink-0 px-3 pb-3 sm:px-5">
        <div class="mx-auto max-w-3xl">
          <div
            v-if="errorText"
            class="mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300"
          >
            <UIcon name="i-heroicons-exclamation-circle" class="mt-0.5 h-4 w-4 shrink-0" />
            <span class="min-w-0 flex-1">{{ errorText }}</span>
            <button type="button" @click="errorText = ''"><UIcon name="i-heroicons-x-mark" class="h-4 w-4" /></button>
          </div>
          <div v-if="!generating && (canRetry || canRegenerate)" class="flex min-h-7 items-center px-1">
            <button
              v-if="canRetry"
              type="button"
              class="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              @click="retry"
            >
              {{ t('common.retry') }}
            </button>
            <button
              v-else-if="canRegenerate"
              type="button"
              class="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              @click="regenerate"
            >
              {{ t('webAI.regenerate') }}
            </button>
          </div>
          <SimpleAIChatInput
            ref="chatInputRef"
            :disabled="generating"
            :status="generating ? 'streaming' : 'ready'"
            :placeholder="t('webAI.inputPlaceholder')"
            @send="handleSend"
            @stop="stop"
          />
          <p class="mt-1.5 text-center text-[11px] text-gray-400">{{ t('webAI.footer') }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
