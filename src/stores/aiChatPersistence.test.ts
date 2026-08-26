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
  let agentRuns = 0
  const replacementInputs: Array<Parameters<AIAdapter['replaceLatestMessageRound']>[1]> = []
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
    addMessagePair: async (
      aiChatId: string,
      userMessage: { content: string },
      assistantMessage: { content: string }
    ) => {
      messagePairWrites++
      if (userMessage.content === 'atomic question') throw persistenceError
      return {
        userMessage: {
          id: 'compressed-user',
          aiChatId,
          role: 'user' as const,
          content: userMessage.content,
          timestamp: 3,
          parentId: 'summary-1',
        },
        assistantMessage: {
          id: 'compressed-assistant',
          aiChatId,
          role: 'assistant' as const,
          content: assistantMessage.content,
          timestamp: 4,
          parentId: 'compressed-user',
        },
      }
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
      { id: 'historical-user', aiChatId, role: 'user' as const, content: 'historical question', timestamp: 1 },
      {
        id: 'historical-assistant',
        aiChatId,
        role: 'assistant' as const,
        content: 'historical answer',
        timestamp: 2,
        parentId: 'historical-user',
      },
      {
        id: 'edit-user',
        aiChatId,
        role: 'user' as const,
        content: 'original question',
        timestamp: 3,
        parentId: 'historical-assistant',
      },
      {
        id: 'edit-assistant',
        aiChatId,
        role: 'assistant' as const,
        content: 'original answer',
        timestamp: 4,
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
    replaceLatestMessageRound: async (
      aiChatId: string,
      input: Parameters<AIAdapter['replaceLatestMessageRound']>[1]
    ) => {
      messageRoundReplacements++
      replacementInputs.push(input)
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
          runStream: (params: unknown, onChunk?: (chunk: AgentStreamChunk) => void) => {
            agentRuns++
            if ((params as { userMessage?: string }).userMessage === 'compressed question') {
              onChunk?.({
                type: 'compression_done',
                compressionResult: {
                  summaryContent: 'compressed context',
                  tokensBefore: 100,
                  tokensAfter: 20,
                  timestamp: 2,
                },
              })
            }
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

  const historicalEditResult = await store.editMessageAndRegenerate(
    editChatKey,
    'historical-user',
    'must not edit history'
  )
  assert.deepEqual(historicalEditResult, { success: false, reason: 'error' })
  assert.equal(agentRuns, 1)
  assert.equal(messageRoundReplacements, 0)

  const editResult = await store.editMessageAndRegenerate(editChatKey, 'edit-user', 'edited question')

  assert.deepEqual(editResult, { success: true })
  assert.equal(messageRoundReplacements, 1)
  assert.equal(legacyEditWrites, 0)
  const editInput = replacementInputs[0]
  assert.ok(editInput)
  assert.equal(editInput.userMessageId, 'edit-user')
  assert.equal(editInput.userContent, 'edited question')
  assert.equal(editInput.assistantMessage.content, 'model answer')
  assert.equal(editInput.assistantMessage.contentBlocks?.length, 1)
  assert.equal(editInput.assistantMessage.contentBlocks?.[0]?.type, 'text')

  const { chatKey: compressionChatKey, state: compressionState } = store.ensureSessionState({
    sessionId: 'session-3',
    sessionName: 'Compressed session',
    chatType: 'private',
    locale: 'zh-CN',
  })
  store.selectAssistantForSession(compressionChatKey, 'general_cn')

  const compressedResult = await store.sendMessage(compressionChatKey, 'compressed question')

  assert.deepEqual(compressedResult, { success: true })
  assert.deepEqual(
    compressionState.messages.map((message) => message.role),
    ['summary', 'user', 'assistant']
  )
  assert.equal(compressionState.messages[1]?.id, 'compressed-user')
  assert.equal(compressionState.messages[2]?.id, 'compressed-assistant')

  const compressedEditResult = await store.editMessageAndRegenerate(
    compressionChatKey,
    'compressed-user',
    'edited compressed question'
  )

  assert.deepEqual(compressedEditResult, { success: true })
  assert.equal(messageRoundReplacements, 2)
  assert.equal(replacementInputs[1]?.userMessageId, 'compressed-user')
  assert.equal(replacementInputs[1]?.userContent, 'edited compressed question')
  assert.deepEqual(
    compressionState.messages.map((message) => message.role),
    ['summary', 'user', 'assistant']
  )
})
