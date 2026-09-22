import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { AIChatManager } from '../../packages/node-runtime/src/ai/chats'
import type { AgentStreamChunk } from '@/services/ai-stream/types'

test('edited turns retain truncated output and usage for reload and continuation, but roll back real failures', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-truncated-edit-'))
  const manager = new AIChatManager(dir, { nativeBinding: process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING })
  const usage = { promptTokens: 100, completionTokens: 25, totalTokens: 125, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let events: AgentStreamChunk[] = []
  let nextHistory: ReturnType<AIChatManager['getHistoryForAgent']> = []
  const aiService = {
    getAIChat: async (id: string) => manager.getAIChat(id),
    getMessages: async (id: string) => manager.getMessages(id),
    getAIChatTokenUsage: async (id: string) => manager.getAIChatTokenUsage(id),
    addMessagePair: async (...args: Parameters<AIChatManager['addMessagePair']>) => manager.addMessagePair(...args),
    replaceLatestMessageRound: async (...args: Parameters<AIChatManager['replaceLatestMessageRound']>) =>
      manager.replaceLatestMessageRound(...args),
  }
  try {
    await t.mock.module('@/stores/session', { namedExports: { useSessionStore: () => ({ sessions: [] }) } })
    await t.mock.module('@/stores/settings', {
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
    })
    await t.mock.module('@/stores/assistant', {
      namedExports: {
        useAssistantStore: () => ({
          isLoaded: true,
          loadAssistants: async () => undefined,
          selectAssistant: () => undefined,
          clearSelection: () => undefined,
        }),
      },
    })
    await t.mock.module('@/stores/skill', {
      namedExports: { useSkillStore: () => ({ activeSkillId: null, activeSkill: ref(null) }) },
    })
    await t.mock.module('@/stores/llm', { namedExports: { useLLMStore: () => ({}) } })
    await t.mock.module('@/services', {
      namedExports: {
        useAIService: () => aiService,
        useDataService: () => ({}),
        useLLMService: () => ({ hasConfig: async () => true }),
      },
    })
    await t.mock.module('@/services/product-analytics', { namedExports: { trackProductEvent: () => undefined } })
    // Keep the real stream service: an error followed by done must still yield success=false.
    await t.mock.module('@/services/utils/sse', {
      namedExports: {
        fetchSSE: async (options: {
          body: { aiChatId: string }
          onEvent: (event: { event: string; data: string }) => void
        }) => {
          nextHistory = manager.getHistoryForAgent(options.body.aiChatId)
          for (const event of events) options.onEvent({ event: event.type, data: JSON.stringify(event) })
        },
      },
    })

    const { useAIChatStore } = await import('./aiChat')
    for (const scenario of [
      { name: 'partial answer', text: 'Partial answer about Project Cedar', errorName: 'OutputLimitError' },
      { name: 'thinking only', text: '', errorName: 'OutputLimitError' },
      { name: 'configuration failure', text: '', errorName: 'ConfigError' },
    ]) {
      await t.test(scenario.name, async () => {
        setActivePinia(createPinia())
        const store = useAIChatStore()
        const chat = manager.createAIChat('session-1', scenario.name, 'general_cn')
        const original = manager.addMessagePair(
          chat.id,
          { content: 'Original question' },
          { content: 'Original answer' }
        )
        const { chatKey, state } = store.ensureSessionState({
          sessionId: 'session-1',
          sessionName: 'Fixture',
          chatType: 'private',
          locale: 'zh-CN',
        })
        await store.loadAIChat(chatKey, chat.id)
        const truncated = scenario.errorName === 'OutputLimitError'
        events = []
        if (truncated) {
          events.push(
            { type: 'think', content: 'Checking the evidence.', thinkTag: 'thinking' },
            { type: 'content', content: scenario.text }
          )
        }
        events.push(
          { type: 'error', error: { name: scenario.errorName, message: 'Generation was interrupted.' } },
          { type: 'done', isFinished: true, ...(truncated ? { usage } : {}) }
        )
        const result = await store.editMessageAndRegenerate(chatKey, original.userMessage.id, 'Edited question')
        assert.deepEqual(result, { success: false, reason: 'error' })
        const expectedContents = truncated
          ? ['Edited question', scenario.text]
          : ['Original question', 'Original answer']
        assert.deepEqual(
          state.messages.map((message) => message.content),
          expectedContents
        )
        assert.deepEqual(
          manager.getMessages(chat.id).map((message) => message.content),
          expectedContents
        )
        assert.equal(manager.getAIChatTokenUsage(chat.id).totalTokens, truncated ? usage.totalTokens : 0)
        if (!truncated) return
        const savedAnswer = manager.getMessages(chat.id)[1]
        assert.ok(savedAnswer.contentBlocks?.some((block) => block.type === 'think'))
        assert.ok(
          savedAnswer.contentBlocks?.some((block) => block.type === 'error' && block.error.name === 'OutputLimitError')
        )
        // Re-open the database, then load the stored turn into a fresh frontend store.
        manager.close()
        setActivePinia(createPinia())
        const reloadedStore = useAIChatStore()
        const reloaded = reloadedStore.ensureSessionState({
          sessionId: 'session-1',
          sessionName: 'Fixture',
          chatType: 'private',
          locale: 'zh-CN',
        })
        await reloadedStore.loadAIChat(reloaded.chatKey, chat.id)
        assert.deepEqual(
          reloaded.state.messages.map((message) => message.content),
          expectedContents
        )
        events = [
          { type: 'content', content: 'Continued answer' },
          { type: 'done', isFinished: true },
        ]
        assert.deepEqual(await reloadedStore.sendMessage(reloaded.chatKey, 'Continue'), { success: true })
        assert.ok(nextHistory.some((message) => message.role === 'user' && message.content === 'Edited question'))
        if (scenario.text) assert.equal(nextHistory.at(-1)?.content, scenario.text)
        assert.equal(manager.getMessages(chat.id).at(-1)?.content, 'Continued answer')
      })
    }
  } finally {
    manager.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
