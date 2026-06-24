import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runPreparedImportBatch } from './preparedImportFlow'

const chats = [
  { chatId: 'chat-a', name: 'A' },
  { chatId: 'chat-b', name: 'B' },
  { chatId: 'chat-c', name: 'C' },
]

describe('prepared import batch flow', () => {
  it('continues after one chat fails and always releases the source', async () => {
    const importCalls: string[] = []
    let releaseCalls = 0

    const result = await runPreparedImportBatch({
      sourceId: 'source-1',
      chats,
      importChat: async (_sourceId, chatId) => {
        importCalls.push(chatId)
        return chatId === 'chat-b'
          ? { success: false, error: 'failed' }
          : { success: true, sessionId: `session-${chatId}` }
      },
      releaseSource: async () => {
        releaseCalls++
      },
    })

    assert.deepEqual(importCalls, ['chat-a', 'chat-b', 'chat-c'])
    assert.equal(result.success, 2)
    assert.equal(result.failed, 1)
    assert.equal(result.cancelled, 0)
    assert.equal(releaseCalls, 1)
  })

  it('does not start remaining chats after cancellation', async () => {
    const importCalls: string[] = []
    let cancelled = false
    let releaseCalls = 0

    const result = await runPreparedImportBatch({
      sourceId: 'source-2',
      chats,
      importChat: async (_sourceId, chatId) => {
        importCalls.push(chatId)
        cancelled = true
        return { success: true, sessionId: `session-${chatId}` }
      },
      releaseSource: async () => {
        releaseCalls++
      },
      isCancelled: () => cancelled,
    })

    assert.deepEqual(importCalls, ['chat-a'])
    assert.equal(result.success, 1)
    assert.equal(result.cancelled, 2)
    assert.equal(releaseCalls, 1)
  })

  it('does not discard completed results when source release fails', async () => {
    const result = await runPreparedImportBatch({
      sourceId: 'source-3',
      chats: [chats[0]],
      importChat: async () => ({ success: true, sessionId: 'session-a' }),
      releaseSource: async () => {
        throw new Error('network unavailable')
      },
    })

    assert.equal(result.success, 1)
    assert.equal(result.failed, 0)
  })
})
