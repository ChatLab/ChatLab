import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentStreamChunk } from '@/services/ai-stream/types'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

test('reports failure when an accepted turn cannot be persisted atomically', async (t) => {
  let messagePairWrites = 0
  let singleMessageWrites = 0
  const persistenceError = new Error('injected persistence failure')
  const aiService = {
    createAIChat: async (sessionId: string, title: string, assistantId: string) => ({
      id: 'chat-1',
      sessionId,
      kind: 'session' as const,
      title,
      assistantId,
      createdAt: 1,
      updatedAt: 1,
    }),
    addMessagePair: async () => {
      messagePairWrites++
      throw persistenceError
    },
    addMessage: async (aiChatId: string, role: 'user' | 'assistant', content: string) => {
      singleMessageWrites++
      if (role === 'assistant') throw persistenceError
      return { id: 'persisted-user', aiChatId, role, content, timestamp: 1 }
    },
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
      namedExports: {
        useAssistantStore: () => ({
          isLoaded: true,
          loadAssistants: async () => undefined,
          selectAssistant: () => undefined,
          clearSelection: () => undefined,
        }),
      },
    }),
    t.mock.module('@/stores/skill', {
      namedExports: { useSkillStore: () => ({ activeSkillId: null, activeSkill: ref(null) }) },
    }),
    t.mock.module('@/stores/llm', {
      namedExports: { useLLMStore: () => ({}) },
    }),
    t.mock.module('@/services', {
      namedExports: {
        useAIService: () => aiService,
        useDataService: () => ({}),
        useLLMService: () => ({ hasConfig: async () => true }),
      },
    }),
    t.mock.module('@/services/ai-stream/service', {
      namedExports: {
        useAgentStreamService: () => ({
          runStream: (_params: unknown, onChunk?: (chunk: AgentStreamChunk) => void) => {
            onChunk?.({ type: 'content', content: 'model answer' })
            onChunk?.({ type: 'done', isFinished: true })
            return {
              requestId: 'stream-1',
              promise: Promise.resolve({
                success: true,
                result: { content: 'model answer', toolsUsed: [], toolRounds: 0 },
              }),
            }
          },
        }),
      },
    }),
  ])

  t.mock.method(console, 'error', () => undefined)
  setActivePinia(createPinia())
  const { useAIChatStore } = await import('./aiChat')
  const store = useAIChatStore()
  const { chatKey } = store.ensureSessionState({
    sessionId: 'session-1',
    sessionName: 'Test session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  store.selectAssistantForSession(chatKey, 'general_cn')

  const result = await store.sendMessage(chatKey, 'atomic question')

  assert.deepEqual(result, { success: false, reason: 'error' })
  assert.equal(messagePairWrites, 1)
  assert.equal(singleMessageWrites, 0)
})
