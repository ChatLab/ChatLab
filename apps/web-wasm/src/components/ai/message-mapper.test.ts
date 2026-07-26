import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toWebAIContentBlocks } from './message-mapper'

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
      { type: 'chart', payload: { spec: { type: 'bar', title: 'Messages' }, rowCount: 1, data: {} } },
      { type: 'text', text: 'done' },
    ])

    assert.deepEqual(
      blocks.map((block) => block.type),
      ['think', 'tool', 'chart', 'text']
    )
    assert.equal(blocks[1]?.type === 'tool' ? blocks[1].tool.status : null, 'done')
  })
})
