import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runChatTurn } from '../apps/cli/src/ai/chat-command'
import { AIChatManager } from '../packages/node-runtime/src/ai/chats'
import { toPiHistoryMessages } from '../packages/node-runtime/src/ai/agent/history'
import { MAX_PERSISTED_TOOL_RESULT_CHARS } from '../packages/core/src/ai/tool-result-text'

// Prevent CLI continuation from forgetting retrieved evidence or mixing concurrent calls.
test('CLI persists completed tool calls for replay after reload', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chatlab-cli-tool-history-'))
  const manager = new AIChatManager(dir, { nativeBinding: process.env.CHATLAB_TEST_SQLITE_NATIVE_BINDING })
  try {
    for (const truncated of [false, true]) {
      await t.test(truncated ? 'truncated answer' : 'complete answer', async () => {
        const evidence = 'Cedar code: 7419\n' + 'x'.repeat(MAX_PERSISTED_TOOL_RESULT_CHARS * 2)
        const turn = await runChatTurn(
          { sessionId: 'synthetic', question: 'Find the project codes', json: true },
          {
            dbManager: { open: () => ({}) } as never,
            pathProvider: {} as never,
            aiChatManager: manager,
            createRunAgentStream: () => async (_params, onEvent) => {
              onEvent({ type: 'content', content: 'Looking up the records. ' })
              for (const id of ['cedar', 'oak']) {
                onEvent({
                  type: 'tool_start',
                  toolName: 'search_messages',
                  toolCallId: id,
                  toolParams: { keywords: [id] },
                })
              }
              onEvent({
                type: 'tool_result',
                toolName: 'search_messages',
                toolCallId: 'oak',
                toolIsError: true,
                toolResult: { content: [{ type: 'text', text: 'Lookup failed' }] },
              })
              onEvent({
                type: 'tool_result',
                toolName: 'search_messages',
                toolCallId: 'cedar',
                toolResult: { content: [{ type: 'text', text: evidence }] },
              })
              onEvent({ type: 'content', content: 'The lookup is complete.' })
              if (truncated) {
                onEvent({ type: 'error', error: { name: 'OutputLimitError', message: 'Output limit reached' } })
              }
              onEvent({ type: 'done', isFinished: true })
            },
          }
        )
        assert.equal(turn.error?.name, truncated ? 'OutputLimitError' : undefined)
        manager.close()
        const replay = toPiHistoryMessages(manager.getHistoryForAgent(turn.aiChatId))
        const calls = replay.flatMap((message) =>
          message.role === 'assistant' ? message.content.filter((block) => block.type === 'toolCall') : []
        )
        assert.deepEqual(
          calls.map(({ id, name, arguments: args }) => ({ id, name, args })),
          [
            { id: 'cedar', name: 'search_messages', args: { keywords: ['cedar'] } },
            { id: 'oak', name: 'search_messages', args: { keywords: ['oak'] } },
          ]
        )
        const results = replay.filter((message) => message.role === 'toolResult')
        assert.deepEqual(
          results.map(({ toolCallId, isError }) => ({ toolCallId, isError })),
          [
            { toolCallId: 'cedar', isError: false },
            { toolCallId: 'oak', isError: true },
          ]
        )
        const text = results[0].content[0]
        assert.equal(text.type, 'text')
        assert.ok(text.type === 'text' && text.text.startsWith('Cedar code: 7419'))
        assert.ok(text.type === 'text' && text.text.length < evidence.length)
        assert.deepEqual(results[1].content, [{ type: 'text', text: 'Lookup failed' }])
        const prose = replay.flatMap((message) =>
          message.role === 'assistant'
            ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
            : []
        )
        assert.deepEqual(prose, ['Looking up the records. ', 'The lookup is complete.'])
      })
    }
  } finally {
    manager.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
