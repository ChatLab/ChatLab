import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toAIConversationListItem, toWebAIContentBlocks } from './message-mapper'

describe('toWebAIContentBlocks', () => {
  it('maps shared runtime blocks to the existing ChatLab message renderer', () => {
    const blocks = toWebAIContentBlocks([
      { type: 'reasoning', text: 'checking' },
      {
        type: 'tool',
        callId: 'call-1',
        name: 'get_chat_overview',
        input: {},
        result: { content: '{"count":12}' },
      },
      { type: 'text', text: 'done' },
    ])

    assert.deepEqual(
      blocks.map((block) => block.type),
      ['think', 'tool', 'text']
    )
    assert.equal(blocks[1]?.type === 'tool' ? blocks[1].tool.status : null, 'done')
  })
})

describe('toAIConversationListItem', () => {
  it('normalizes Browser Runtime millisecond timestamps for the shared conversation list', () => {
    const createdAt = Date.UTC(2025, 0, 1, 12)
    const updatedAt = Date.UTC(2025, 5, 1, 12)

    const item = toAIConversationListItem({
      id: 'conversation-1',
      sessionId: 'session-1',
      title: 'Conversation',
      createdAt,
      updatedAt,
    })

    assert.equal(item.createdAt, Math.floor(createdAt / 1000))
    assert.equal(item.updatedAt, Math.floor(updatedAt / 1000))
  })
})
