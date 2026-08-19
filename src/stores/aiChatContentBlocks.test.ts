import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPersistedProcessDurationMs,
  persistProcessDurationMs,
  toSerializableContentBlocks,
} from './aiChatContentBlocks'

describe('process duration metadata', () => {
  it('persists the final processing duration on the final response text', () => {
    const blocks = [
      { type: 'text' as const, text: 'interstitial response' },
      {
        type: 'tool' as const,
        tool: { name: 'search_messages', displayName: 'search_messages', status: 'done' as const },
      },
      { type: 'text' as const, text: 'final response' },
    ]

    const persisted = persistProcessDurationMs(blocks, 15_000)

    assert.equal(getPersistedProcessDurationMs(persisted), 15_000)
    assert.deepEqual(persisted, [
      blocks[0],
      blocks[1],
      { type: 'text', text: 'final response', processDurationMs: 15_000 },
    ])
    assert.equal(getPersistedProcessDurationMs(blocks), undefined)
  })
})

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
