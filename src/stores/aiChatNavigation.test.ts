import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentStreamChunk, AgentStreamResult } from '@/services/ai-stream/types'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

test('restores the latest valid AI chat without leaking stale navigation state', async (t) => {
  let hasLLMConfig = false
  let agentStreamRun:
    | ((onChunk?: (chunk: AgentStreamChunk) => void) => { requestId: string; promise: Promise<AgentStreamResult> })
    | null = null
  let savedMessageId = 0
  const makeConversation = (id: string, sessionId = 'session-one') => ({
    id,
    sessionId,
    kind: 'session' as const,
    title: 'Saved chat',
    assistantId: 'assistant-one',
    createdAt: 1,
    updatedAt: 1,
  })
  let resolveSlowConversation!: (conversation: ReturnType<typeof makeConversation>) => void
  const slowConversation = new Promise<ReturnType<typeof makeConversation>>((resolve) => {
    resolveSlowConversation = resolve
  })
  let resolveStaleList!: (conversations: ReturnType<typeof makeConversation>[]) => void
  const staleList = new Promise<ReturnType<typeof makeConversation>[]>((resolve) => {
    resolveStaleList = resolve
  })
  let staleListRequestCount = 0
  const aiService = {
    getAIChat: async (id: string) => {
      if (id === 'chat-slow') return slowConversation
      if (id === 'chat-one' || id === 'chat-newest') return makeConversation(id)
      if (id === 'chat-restored' || id === 'chat-user-choice') return makeConversation(id, 'session-four')
      return id === 'chat-latest' ? makeConversation(id, 'session-three') : null
    },
    getAIChats: async (sessionId: string) => {
      if (sessionId === 'session-three') return [makeConversation('chat-latest', sessionId)]
      if (sessionId === 'session-four') {
        staleListRequestCount++
        if (staleListRequestCount === 1) return staleList
        return [makeConversation('chat-restored', sessionId)]
      }
      return []
    },
    getMessages: async (aiChatId: string) => [
      {
        id: `message-${aiChatId}`,
        aiChatId,
        role: 'assistant' as const,
        content: `Saved answer for ${aiChatId}`,
        timestamp: 1,
      },
    ],
    getAIChatTokenUsage: async () => ({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    }),
    createAIChat: async () => {
      throw new Error('create failed')
    },
    addMessage: async (
      aiChatId: string,
      role: 'user' | 'assistant',
      content: string,
      _dataKeywords?: string[],
      _dataMessageCount?: number,
      contentBlocks?: unknown,
      _tokenUsage?: unknown,
      entityRefs?: unknown
    ) => ({
      id: `saved-${++savedMessageId}`,
      aiChatId,
      role,
      content,
      timestamp: 1,
      contentBlocks,
      entityRefs,
    }),
  }
  const assistantStore = {
    isLoaded: true,
    loadAssistants: async () => undefined,
    selectAssistant: () => undefined,
    clearSelection: () => undefined,
  }

  await Promise.all([
    t.mock.module('@/stores/session', {
      namedExports: { useSessionStore: () => ({ sessions: [] }) },
    }),
    t.mock.module('@/stores/settings', {
      namedExports: {
        useSettingsStore: () => ({
          aiPreprocessConfig: {
            dataCleaning: false,
            mergeConsecutive: false,
            mergeWindowSeconds: 180,
            blacklistKeywords: [],
            denoise: false,
            desensitize: false,
            desensitizeRules: [],
            anonymizeNames: false,
          },
        }),
      },
    }),
    t.mock.module('@/stores/assistant', {
      namedExports: { useAssistantStore: () => assistantStore },
    }),
    t.mock.module('@/stores/skill', {
      namedExports: { useSkillStore: () => ({ activeSkill: ref(null) }) },
    }),
    t.mock.module('@/stores/llm', {
      namedExports: { useLLMStore: () => ({}) },
    }),
    t.mock.module('@/services', {
      namedExports: {
        useAIService: () => aiService,
        useDataService: () => ({}),
        useLLMService: () => ({ hasConfig: async () => hasLLMConfig }),
      },
    }),
    t.mock.module('@/services/ai-stream/service', {
      namedExports: {
        useAgentStreamService: () => ({
          runStream: (_params: unknown, onChunk?: (chunk: AgentStreamChunk) => void) => {
            if (!agentStreamRun) throw new Error('agent stream is not configured')
            return agentStreamRun(onChunk)
          },
        }),
      },
    }),
  ])

  setActivePinia(createPinia())
  const { useAIChatStore } = await import('./aiChat')
  const store = useAIChatStore()

  const first = store.ensureSessionState({
    sessionId: 'session-one',
    sessionName: 'First session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  await store.resetToSelectorOnEnter(first.chatKey, 'chat-one')

  assert.equal(first.state.currentAIChatId, 'chat-one')
  assert.equal(first.state.messages[0]?.content, 'Saved answer for chat-one')

  const second = store.ensureSessionState({
    sessionId: 'session-two',
    sessionName: 'Second session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  await store.resetToSelectorOnEnter(second.chatKey, 'chat-one')

  assert.equal(second.state.currentAIChatId, null)
  assert.equal(second.state.messages.length, 0)

  const staleLoad = store.loadAIChat(first.chatKey, 'chat-slow')
  assert.equal(await store.loadAIChat(first.chatKey, 'chat-newest'), true)
  resolveSlowConversation(makeConversation('chat-slow'))

  assert.equal(await staleLoad, false)
  assert.equal(first.state.currentAIChatId, 'chat-newest')
  assert.equal(first.state.messages[0]?.content, 'Saved answer for chat-newest')

  const third = store.ensureSessionState({
    sessionId: 'session-three',
    sessionName: 'Third session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  await store.resetToSelectorOnEnter(third.chatKey)

  assert.equal(third.state.currentAIChatId, 'chat-latest')
  assert.equal(third.state.messages[0]?.content, 'Saved answer for chat-latest')

  const fourth = store.ensureSessionState({
    sessionId: 'session-four',
    sessionName: 'Fourth session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  const staleRestore = store.resetToSelectorOnEnter(fourth.chatKey)
  await store.resetToSelectorOnEnter(fourth.chatKey)
  assert.equal(await store.loadAIChat(fourth.chatKey, 'chat-user-choice'), true)

  resolveStaleList([makeConversation('chat-restored', 'session-four')])
  await staleRestore

  assert.equal(fourth.state.currentAIChatId, 'chat-user-choice')
  assert.equal(fourth.state.messages[0]?.content, 'Saved answer for chat-user-choice')

  const fifth = store.ensureSessionState({
    sessionId: 'session-five',
    sessionName: 'Fifth session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  store.selectAssistantForSession(fifth.chatKey, 'assistant-one')
  let acceptedCount = 0
  const onAccepted = () => acceptedCount++

  const noConfigResult = await store.sendMessage(fifth.chatKey, 'Keep this draft', { onAccepted })
  assert.equal(noConfigResult.reason, 'no_config')
  assert.equal(acceptedCount, 0)

  fifth.state.isAIThinking = true
  const busyResult = await store.sendMessage(fifth.chatKey, 'Keep this draft', { onAccepted })
  fifth.state.isAIThinking = false
  assert.equal(busyResult.reason, 'busy')
  assert.equal(acceptedCount, 0)

  hasLLMConfig = true
  t.mock.method(console, 'error', () => undefined)
  const acceptedResult = await store.sendMessage(fifth.chatKey, 'Accepted draft', { onAccepted })
  assert.equal(acceptedResult.reason, 'error')
  assert.equal(acceptedCount, 1)
  assert.equal(
    fifth.state.messages.some((message) => message.role === 'user' && message.content === 'Accepted draft'),
    true
  )

  const streamError = { name: 'ProviderError', message: 'provider unavailable', stack: null }
  agentStreamRun = (onChunk) => {
    onChunk?.({ type: 'error', error: streamError })
    onChunk?.({
      type: 'done',
      isFinished: true,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    return {
      requestId: 'stream-error',
      promise: Promise.resolve({ success: false, error: streamError }),
    }
  }
  const streamFailureResult = await store.sendMessage(first.chatKey, 'Trigger provider failure')
  const failedAssistant = first.state.messages.findLast((message) => message.role === 'assistant')

  assert.deepEqual(
    {
      result: streamFailureResult,
      phase: first.state.agentStatus?.phase,
      errorBlocks: failedAssistant?.contentBlocks?.filter((block) => block.type === 'error').length,
    },
    {
      result: { success: false, reason: 'error' },
      phase: 'error',
      errorBlocks: 1,
    }
  )

  const global = store.ensureGlobalState('zh-CN')
  store.activeTask = {
    requestId: 'global-request',
    kind: 'global',
    chatKey: global.chatKey,
    sessionId: '',
    sessionName: 'Global AI analysis',
    chatType: 'group',
    aiChatId: null,
    questionPreview: 'Global question',
    startedAt: 1,
  }

  assert.equal(store.focusActiveTaskAIChat(), true)
  assert.equal(store.startNewAIChat(first.chatKey), true)
  await store.resetToSelectorOnEnter(first.chatKey, 'chat-one')

  assert.equal(first.state.currentAIChatId, 'chat-one')
  assert.equal(first.state.messages[0]?.content, 'Saved answer for chat-one')
})
