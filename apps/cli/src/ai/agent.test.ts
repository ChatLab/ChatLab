import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { AIChatManager } from '../../../../packages/node-runtime/src/ai/chats'
import type { AgentStreamChunk } from '@openchatlab/node-runtime'

test('cancelling a session agent must not persist a compression summary', async (t) => {
  let controller: AbortController
  let compressionCalls = 0
  let compressionSignal: AbortSignal | undefined
  await t.mock.module('../../../../packages/node-runtime/src/ai/compression/adapter-factory', {
    namedExports: {
      createCompressionLlmAdapter: (options: { onCompressing?: () => void }) => ({
        contextWindow: 1000,
        compress: async (_prompt: string, _maxTokens: number, signal?: AbortSignal) => {
          options.onCompressing?.()
          compressionCalls++
          compressionSignal = signal
          controller.abort()
          return 'Summary returned after cancellation'
        },
      }),
    },
  })
  const { runServerAgent } = await import('./agent')

  for (const alreadyAborted of [true, false]) {
    await t.test(alreadyAborted ? 'cancelled before compression' : 'cancelled during compression', async () => {
      controller = new AbortController()
      compressionCalls = 0
      compressionSignal = undefined
      const dir = mkdtempSync(join(tmpdir(), 'chatlab-session-cancel-'))
      const nativeBinding = process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING
      const manager = new AIChatManager(dir, nativeBinding ? { nativeBinding } : undefined)
      try {
        const chat = manager.createAIChat('session-1', 'Cancellation', 'general_cn')
        for (let index = 0; index < 6; index++) {
          const message = manager.addMessage(chat.id, index % 2 ? 'assistant' : 'user', 'history '.repeat(200))
          manager.executeAiSQL(`UPDATE ai_message SET timestamp = ${1700000000 + index} WHERE id = '${message.id}'`)
        }
        const activeBefore = manager.getAIChat(chat.id)?.activeMessageId
        const events: AgentStreamChunk[] = []
        if (alreadyAborted) controller.abort()

        await runServerAgent({
          userMessage: 'Continue',
          aiChatId: chat.id,
          aiChatManager: manager,
          llmConfig: { provider: 'openai-compatible', model: 'test-model', apiKey: 'test-placeholder' },
          abortSignal: controller.signal,
          onEvent: (event) => events.push(event),
        })

        assert.equal(manager.getLatestSummary(chat.id), null)
        assert.equal(manager.getAIChat(chat.id)?.activeMessageId, activeBefore)
        assert.equal(compressionCalls, alreadyAborted ? 0 : 1)
        if (!alreadyAborted) assert.equal(compressionSignal, controller.signal)
        assert.equal(
          events.some((event) => event.type === 'compression_done'),
          false
        )
        assert.deepEqual(
          events
            .filter((event) => event.type === 'status')
            .map((event) => event.status?.phase)
            .filter((phase) => phase === 'aborted' || phase === 'completed' || phase === 'error'),
          ['aborted']
        )
        assert.equal(events.filter((event) => event.type === 'done').length, 1)
      } finally {
        manager.close()
        assert.equal(dirname(dir), tmpdir())
        assert.ok(basename(dir).startsWith('chatlab-session-cancel-'))
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      }
    })
  }
})
