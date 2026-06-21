import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toSerializableContentBlocks } from './aiChatContentBlocks'

describe('toSerializableContentBlocks', () => {
  it('drops full displayResult text from persisted tool blocks', () => {
    const fullText = 'x'.repeat(10_000)
    const blocks = [
      { type: 'text' as const, text: 'answer' },
      {
        type: 'tool' as const,
        tool: {
          name: 'search_messages',
          displayName: 'search_messages',
          status: 'done' as const,
          params: { keyword: 'x' },
          result: 'truncated result\n…[truncated]',
          displayResult: fullText,
        },
      },
    ]

    const serializable = toSerializableContentBlocks(blocks)

    const runtimeToolBlock = blocks[1]
    assert.ok(runtimeToolBlock)
    if (runtimeToolBlock.type !== 'tool') throw new Error('expected runtime tool block')
    assert.ok(serializable)
    assert.equal(runtimeToolBlock.tool.displayResult, fullText, 'runtime block should keep displayResult')
    assert.deepEqual(serializable, [
      { type: 'text', text: 'answer' },
      {
        type: 'tool',
        tool: {
          name: 'search_messages',
          displayName: 'search_messages',
          status: 'done',
          params: { keyword: 'x' },
          result: 'truncated result\n…[truncated]',
        },
      },
    ])
    assert.equal(JSON.stringify(serializable).includes(fullText), false)
  })
})
