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
  it('rejects empty content', () => {
    assert.equal(isValidMessage(''), false)
    assert.equal(isValidMessage('  '), false)
  })

  it('rejects meaningless short replies', () => {
    assert.equal(isValidMessage('嗯'), false)
    assert.equal(isValidMessage('ok'), false)
    assert.equal(isValidMessage('lol'), false)
  })

  it('accepts meaningful short replies', () => {
    assert.equal(isValidMessage('好的'), true)
    assert.equal(isValidMessage('可以'), true)
  })

  it('rejects placeholders', () => {
    assert.equal(isValidMessage('[图片]'), false)
    assert.equal(isValidMessage('[image]'), false)
    assert.equal(isValidMessage('[sticker]'), false)
  })

  it('accepts normal text', () => {
    assert.equal(isValidMessage('今天天气真好'), true)
    assert.equal(isValidMessage('Hello, how are you?'), true)
  })

  it('rejects system messages', () => {
    assert.equal(isValidMessage('张三邀请李四加入了群聊'), false)
    assert.equal(isValidMessage('Alice invited Bob to the group'), false)
  })
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

  it('returns error when too few messages', async () => {
    const deps = mockDeps([{ senderName: 'A', content: 'hi' }])
    const result = await generateSessionSummary(deps, 1)
    assert.equal(result.success, false)
  })

  it('returns error when session not found', async () => {
    const deps = mockDeps(null)
    const result = await generateSessionSummary(deps, 1)
    assert.equal(result.success, false)
  })
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
