import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

test('restores the latest valid AI chat without leaking stale navigation state', async (t) => {
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
  const aiService = {
    getAIChat: async (id: string) => {
      if (id === 'chat-slow') return slowConversation
      if (id === 'chat-one' || id === 'chat-newest') return makeConversation(id)
      return id === 'chat-latest' ? makeConversation(id, 'session-three') : null
    },
    getAIChats: async (sessionId: string) =>
      sessionId === 'session-three' ? [makeConversation('chat-latest', sessionId)] : [],
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
      namedExports: { useSettingsStore: () => ({ aiPreprocessConfig: {} }) },
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
        useLLMService: () => ({}),
      },
    }),
    t.mock.module('@/services/ai-stream/service', {
      namedExports: { useAgentStreamService: () => ({}) },
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
