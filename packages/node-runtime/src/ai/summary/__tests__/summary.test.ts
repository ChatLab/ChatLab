/**
 * Tests for shared summary pipeline.
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/summary/__tests__/summary.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidMessage,
  filterValidMessages,
  splitIntoSegments,
  generateSessionSummary,
  checkSessionsCanGenerateSummary,
} from '../index'
import type { SummaryDeps, SummaryMessage } from '../index'

describe('isValidMessage', () => {
  const cases: Array<{ name: string; expected: boolean; messages: string[] }> = [
    { name: 'rejects empty content', expected: false, messages: ['', '  '] },
    { name: 'rejects meaningless short replies', expected: false, messages: ['嗯', 'ok', 'lol'] },
    { name: 'accepts meaningful short replies', expected: true, messages: ['好的', '可以'] },
    { name: 'rejects placeholders', expected: false, messages: ['[图片]', '[image]', '[sticker]'] },
    { name: 'accepts normal text', expected: true, messages: ['今天天气真好', 'Hello, how are you?'] },
    {
      name: 'rejects system messages',
      expected: false,
      messages: ['张三邀请李四加入了群聊', 'Alice invited Bob to the group'],
    },
  ]

  for (const { name, expected, messages } of cases) {
    it(name, () => {
      for (const message of messages) assert.equal(isValidMessage(message), expected)
    })
  }
})

describe('filterValidMessages', () => {
  it('filters out invalid messages', () => {
    const messages: SummaryMessage[] = [
      { senderName: 'A', content: '你好世界' },
      { senderName: 'B', content: '[图片]' },
      { senderName: 'C', content: null },
      { senderName: 'D', content: '好的，我知道了' },
    ]
    const result = filterValidMessages(messages)
    assert.equal(result.length, 2)
    assert.equal(result[0].senderName, 'A')
    assert.equal(result[1].senderName, 'D')
  })
})

describe('splitIntoSegments', () => {
  it('splits messages by character limit', () => {
    const messages = Array.from({ length: 10 }, () => ({
      senderName: 'User',
      content: 'A'.repeat(100),
    }))
    const segments = splitIntoSegments(messages, 350)
    assert.ok(segments.length >= 3)
    for (const seg of segments) {
      assert.ok(seg.length > 0)
    }
  })

  it('returns single segment for short input', () => {
    const messages = [{ senderName: 'A', content: 'short' }]
    const segments = splitIntoSegments(messages, 1000)
    assert.equal(segments.length, 1)
  })
})

describe('generateSessionSummary', () => {
  function mockDeps(
    messages: SummaryMessage[] | null,
    existingSummary?: string
  ): SummaryDeps & { getSavedSummary: () => string } {
    const state = { saved: '' }
    return {
      loadMessages: () => messages,
      saveSummary: (_id, s) => {
        state.saved = s
      },
      getSummary: () => existingSummary ?? null,
      llmComplete: async (_sys, _usr) => 'Mock summary result',
      t: (key) => `[${key}]`,
      getSavedSummary: () => state.saved,
    }
  }

  it('returns existing summary when not forcing regeneration', async () => {
    const deps = mockDeps(null, 'Existing summary')
    const result = await generateSessionSummary(deps, 1)
    assert.equal(result.success, true)
    assert.equal(result.summary, 'Existing summary')
  })

  it('regenerates when forceRegenerate is true', async () => {
    const msgs: SummaryMessage[] = Array.from({ length: 5 }, (_, i) => ({
      senderName: `User${i}`,
      content: `Message content number ${i} with enough text`,
    }))
    const deps = mockDeps(msgs, 'Old summary')
    const result = await generateSessionSummary(deps, 1, { forceRegenerate: true })
    assert.equal(result.success, true)
    assert.equal(result.summary, 'Mock summary result')
  })

  const errorCases: Array<{ name: string; messages: SummaryMessage[] | null }> = [
    { name: 'returns error when too few messages', messages: [{ senderName: 'A', content: 'hi' }] },
    { name: 'returns error when session not found', messages: null },
  ]

  for (const { name, messages } of errorCases) {
    it(name, async () => {
      const result = await generateSessionSummary(mockDeps(messages), 1)
      assert.equal(result.success, false)
    })
  }
})

describe('checkSessionsCanGenerateSummary', () => {
  it('correctly identifies eligible sessions', () => {
    const deps = {
      loadMessages: (id: number) => {
        if (id === 1) return Array.from({ length: 5 }, () => ({ senderName: 'A', content: 'Good content here' }))
        if (id === 2) return [{ senderName: 'B', content: '[图片]' }]
        return null
      },
      t: (key: string) => `[${key}]`,
    }

    const results = checkSessionsCanGenerateSummary(deps, [1, 2, 3])
    assert.equal(results.get(1)?.canGenerate, true)
    assert.equal(results.get(2)?.canGenerate, false)
    assert.equal(results.get(3)?.canGenerate, false)
  })
})
