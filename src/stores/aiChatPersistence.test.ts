import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentStreamChunk } from '@/services/ai-stream/types'
import type { AIAdapter } from '@/services/ai/types'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

test('uses atomic persistence operations for new and edited turns', async (t) => {
  let messagePairWrites = 0
  let singleMessageWrites = 0
  let messageRoundReplacements = 0
  let legacyEditWrites = 0
  let replacementInput: Parameters<AIAdapter['replaceMessageRound']>[1] | undefined
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
    getAIChat: async (aiChatId: string) => ({
      id: aiChatId,
      sessionId: 'session-2',
      kind: 'session' as const,
      title: 'Editable chat',
      assistantId: 'general_cn',
      createdAt: 1,
      updatedAt: 1,
    }),
    getMessages: async (aiChatId: string) => [
      { id: 'edit-user', aiChatId, role: 'user' as const, content: 'original question', timestamp: 1 },
      {
        id: 'edit-assistant',
        aiChatId,
        role: 'assistant' as const,
        content: 'original answer',
        timestamp: 2,
        parentId: 'edit-user',
      },
    ],
    getAIChatTokenUsage: async () => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
    replaceMessageRound: async (aiChatId: string, input: Parameters<AIAdapter['replaceMessageRound']>[1]) => {
      messageRoundReplacements++
      replacementInput = input
      return {
        id: 'replacement-assistant',
        aiChatId,
        role: 'assistant' as const,
        content: input.assistantMessage.content,
        contentBlocks: input.assistantMessage.contentBlocks,
        tokenUsage: input.assistantMessage.tokenUsage,
        timestamp: 3,
        parentId: input.userMessageId,
      }
    },
    updateMessageContent: async () => {
      legacyEditWrites++
    },
    deleteAndRelinkMessage: async () => {
      legacyEditWrites++
    },
    insertMessageAfter: async () => {
      legacyEditWrites++
      throw new Error('legacy edit persistence should not be used')
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

  const { chatKey: editChatKey } = store.ensureSessionState({
    sessionId: 'session-2',
    sessionName: 'Editable session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  assert.equal(await store.loadAIChat(editChatKey, 'chat-edit'), true)

  const editResult = await store.editMessageAndRegenerate(editChatKey, 'edit-user', 'edited question')

  assert.deepEqual(editResult, { success: true })
  assert.equal(messageRoundReplacements, 1)
  assert.equal(legacyEditWrites, 0)
  assert.ok(replacementInput)
  assert.equal(replacementInput.userMessageId, 'edit-user')
  assert.equal(replacementInput.userContent, 'edited question')
  assert.equal(replacementInput.oldAssistantMessageId, 'edit-assistant')
  assert.equal(replacementInput.assistantMessage.content, 'model answer')
  assert.equal(replacementInput.assistantMessage.contentBlocks?.length, 1)
  assert.equal(replacementInput.assistantMessage.contentBlocks?.[0]?.type, 'text')
})
