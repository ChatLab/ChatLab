import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_COMPRESSION_POLICY, selectCompressionMessages } from './context-compression'
import type { RuntimeMessage } from './types'

function message(id: string, content: string): RuntimeMessage {
  return { id, conversationId: 'conversation-1', role: 'user', content, createdAt: Number(id) }
}

describe('selectCompressionMessages', () => {
  it('keeps history untouched below the 70 percent threshold', () => {
    const messages = [message('1', 'short message')]
    const result = selectCompressionMessages(
      messages,
      { model: {} as never, contextWindow: 1_000 },
      DEFAULT_COMPRESSION_POLICY,
      'system'
    )
    assert.equal(result.shouldCompress, false)
    assert.deepEqual(result.recentMessages, messages)
  })

  it('selects old messages and retains the recent 20 percent buffer', () => {
    const messages = Array.from({ length: 8 }, (_, index) => message(String(index + 1), '中'.repeat(120)))
    const result = selectCompressionMessages(
      messages,
      { model: {} as never, contextWindow: 1_000 },
      DEFAULT_COMPRESSION_POLICY,
      'system'
    )
    assert.equal(result.shouldCompress, true)
    assert.ok(result.oldMessages.length >= DEFAULT_COMPRESSION_POLICY.minMessages)
    assert.ok(result.recentMessages.length > 0)
    assert.deepEqual([...result.oldMessages, ...result.recentMessages], messages)
  })
})
