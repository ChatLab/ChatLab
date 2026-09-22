import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { AIChatManager } from '../../packages/node-runtime/src/ai/chats'
import type { AgentStreamChunk, AgentStreamParams, AgentStreamResult } from '@/services/ai-stream/types'

test('stopped turns survive reload and continuation without saving cancelled edits', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-stopped-turn-'))
  const nativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING
  const manager = new AIChatManager(dir, nativeBinding ? { nativeBinding } : undefined)
  let started = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<AgentStreamResult>()
  const saving = Promise.withResolvers<void>()
  const allowSave = Promise.withResolvers<void>()
  let preprocessing = Promise.withResolvers<void>()
  let allowPreprocess = Promise.withResolvers<void>()
  let continuing = false
  let providerStarted = false
  const settings = {
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
    ensureDesensitizeRules: async () => {
      preprocessing.resolve()
      await allowPreprocess.promise
    },
  }
  let nextHistory: ReturnType<AIChatManager['getHistoryForAgent']> = []
  const aiService = {
    createGlobalAIChat: async (title: string, assistantId: string) => manager.createGlobalAIChat(title, assistantId),
    getAIChat: async (id: string) => manager.getAIChat(id),
    getMessages: async (id: string) => manager.getMessages(id),
    getAIChatTokenUsage: async (id: string) => manager.getAIChatTokenUsage(id),
    addMessagePair: async (...args: Parameters<AIChatManager['addMessagePair']>) => {
      saving.resolve()
      await allowSave.promise
      return manager.addMessagePair(...args)
    },
    replaceLatestMessageRound: async (...args: Parameters<AIChatManager['replaceLatestMessageRound']>) =>
      manager.replaceLatestMessageRound(...args),
  }
  try {
    await Promise.all([
      t.mock.module('@/stores/session', { namedExports: { useSessionStore: () => ({ sessions: [] }) } }),
      t.mock.module('@/stores/settings', { namedExports: { useSettingsStore: () => settings } }),
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
      t.mock.module('@/stores/llm', { namedExports: { useLLMStore: () => ({}) } }),
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
            runStream: (params: AgentStreamParams, onChunk: (chunk: AgentStreamChunk) => void) => {
              providerStarted = true
              if (continuing) {
                nextHistory = manager.getHistoryForAgent(params.aiChatId!)
                onChunk({ type: 'content', content: 'Continued answer' })
                onChunk({ type: 'done', isFinished: true })
                return {
                  requestId: 'continued-run',
                  promise: Promise.resolve({
                    success: true,
                    result: { content: 'Continued answer', toolsUsed: [], toolRounds: 0 },
                  }),
                }
              }
              // No status or turn-end event: this text is still queued when Stop is clicked.
              onChunk({ type: 'content', content: 'Partial answer about Project Cedar' })
              started.resolve()
              return { requestId: 'stopped-run', promise: finish.promise }
            },
            abort: async () => {
              finish.resolve({ success: false, result: { content: '', toolsUsed: [], toolRounds: 0, aborted: true } })
            },
          }),
        },
      }),
    ])
    setActivePinia(createPinia())
    const { useAIChatStore } = await import('./aiChat')
    const store = useAIChatStore()
    const { chatKey, state } = store.ensureGlobalState('en-US')
    store.selectAssistantForSession(chatKey, 'general_en')
    const pending = store.sendMessage(chatKey, 'Explain the Project Cedar schedule')
    await started.promise
    const runningChatId = store.activeTask!.aiChatId!
    const otherChat = manager.createGlobalAIChat('Other conversation', 'general_en')
    manager.addMessagePair(otherChat.id, { content: 'Unrelated question' }, { content: 'Unrelated answer' })
    assert.equal(await store.loadAIChat(chatKey, otherChat.id), true)
    assert.equal(await store.stopGeneration(chatKey), true)
    assert.equal(await store.stopGeneration(chatKey), false)
    assert.equal(
      await Promise.race([saving.promise.then(() => 'saving'), pending.then(() => 'finished')]),
      'saving',
      'A stopped turn must be saved before the request finishes'
    )
    assert.equal((await store.sendMessage(chatKey, 'Continue before the stopped turn is saved')).reason, 'busy')
    allowSave.resolve()
    assert.deepEqual(await pending, { success: false, reason: 'aborted' })
    assert.deepEqual(
      state.messages.map((m) => m.content),
      ['Unrelated question', 'Unrelated answer']
    )
    manager.close()
    const saved = manager.getMessages(runningChatId)
    assert.equal(saved.length, 2)
    assert.equal(saved[0].content, 'Explain the Project Cedar schedule')
    assert.equal(saved[1].content, 'Partial answer about Project Cedar\n\n_（已停止生成）_')
    assert.equal(saved[1].contentBlocks?.[0]?.type, 'text')
    assert.equal(saved[1].contentBlocks?.[0]?.type === 'text' && saved[1].contentBlocks[0].text, saved[1].content)
    assert.equal(await store.loadAIChat(chatKey, runningChatId), true)
    assert.deepEqual(
      state.messages.map((m) => m.id),
      saved.map((m) => m.id)
    )
    continuing = true
    assert.deepEqual(await store.sendMessage(chatKey, 'Continue with the schedule'), { success: true })
    assert.deepEqual(
      nextHistory.map((m) => m.content),
      saved.map((m) => m.content)
    )
    assert.equal(manager.getMessages(runningChatId).length, 4)

    const editChat = manager.createAIChat('edit-session', 'Editable conversation', 'general_en')
    const original = manager.addMessagePair(
      editChat.id,
      { content: 'Original question' },
      { content: 'Original answer' }
    )
    const { chatKey: editKey } = store.ensureSessionState({
      sessionId: 'edit-session',
      sessionName: 'Editable',
      chatType: 'private',
      locale: 'en-US',
    })
    assert.equal(await store.loadAIChat(editKey, editChat.id), true)
    continuing = false
    started = Promise.withResolvers<void>()
    finish = Promise.withResolvers<AgentStreamResult>()
    const editing = store.editMessageAndRegenerate(editKey, original.userMessage.id, 'Edited question')
    await started.promise
    await store.stopGeneration(editKey)
    assert.deepEqual(await editing, { success: false, reason: 'aborted' })
    assert.deepEqual(
      manager.getMessages(editChat.id).map((m) => m.content),
      ['Original question', 'Original answer']
    )

    settings.aiPreprocessConfig.desensitize = true
    continuing = true
    for (const operation of ['send', 'edit']) {
      preprocessing = Promise.withResolvers<void>()
      allowPreprocess = Promise.withResolvers<void>()
      providerStarted = false
      const before = manager.getMessages(editChat.id)
      const preparing =
        operation === 'send'
          ? store.sendMessage(editKey, 'Question stopped during preprocessing')
          : store.editMessageAndRegenerate(editKey, before.findLast((m) => m.role === 'user')!.id, 'Cancelled edit')
      await preprocessing.promise
      assert.equal(await store.stopGeneration(editKey), true)
      allowPreprocess.resolve()
      assert.deepEqual(await preparing, { success: false, reason: 'aborted' })
      assert.equal(providerStarted, false, 'Stopping preprocessing must prevent starting a provider request')
      assert.equal(store.activeTask, null)
      assert.deepEqual(
        manager.getMessages(editChat.id).map((m) => m.content),
        operation === 'send'
          ? [...before.map((m) => m.content), 'Question stopped during preprocessing', '\n\n_（已停止生成）_']
          : before.map((m) => m.content)
      )
    }
  } finally {
    manager.close()
    assert.equal(dirname(dir), tmpdir())
    assert.ok(basename(dir).startsWith('chatlab-stopped-turn-'))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
