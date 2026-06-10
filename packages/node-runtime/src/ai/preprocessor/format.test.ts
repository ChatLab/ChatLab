/**
 * Tests for tool result text formatting.
 *
 * Regression for: rawMessages object arrays leaking into the LLM-facing
 * text as "rawMessages: [object Object], [object Object], ..." — wasting
 * context tokens on every message-retrieval tool call and polluting the
 * tool result text persisted for history replay.
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/preprocessor/format.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatToolResultAsText } from './format'
import { applyPreprocessingPipeline } from './preprocessing-pipeline'
import type { PreprocessableMessage } from './types'

const rawMessages: PreprocessableMessage[] = [
  { id: 1, senderName: 'Alice', content: 'hello world', timestamp: 1710000000 },
  { id: 2, senderName: 'Bob', content: 'hi there', timestamp: 1710000060 },
]

describe('formatToolResultAsText', () => {
  it('skips rawMessages and renders scalar metadata plus formatted messages', () => {
    const text = formatToolResultAsText({
      total: 100,
      timeRange: '全部时间',
      rawMessages,
      messages: ['2024/03/09 16:40 Alice: hello world', '2024/03/09 16:41 Bob: hi there'],
    })

    assert.ok(!text.includes('[object Object]'))
    assert.ok(!text.includes('rawMessages'))
    assert.ok(text.includes('total: 100'))
    assert.ok(text.includes('timeRange: 全部时间'))
    assert.ok(text.includes('Alice: hello world'))
  })

  it('still renders scalar arrays inline', () => {
    const text = formatToolResultAsText({ keywords: ['生日', '聚餐'] })
    assert.equal(text, 'keywords: 生日, 聚餐')
  })
})

describe('applyPreprocessingPipeline', () => {
  it('produces clean text even when extraDetails mirrors rawMessages', () => {
    const result = applyPreprocessingPipeline({
      rawMessages,
      extraDetails: { total: 2, timeRange: '全部时间', rawMessages },
    })

    assert.ok(!result.text.includes('[object Object]'))
    assert.ok(result.text.includes('total: 2'))
    assert.ok(result.text.includes('hello world'))
    assert.ok(result.text.includes('hi there'))
  })
})
