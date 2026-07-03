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
import { formatToolResultAsText, formatMessageCompact } from './format'
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

describe('formatMessageCompact id citations (CLI agent format)', () => {
  const message = { id: 1021, senderName: '老王', content: '报销流程是不是改了？', timestamp: 1710000000 }

  it('renders no id prefix by default (desktop AI regression)', () => {
    const line = formatMessageCompact(message, 'zh-CN')
    assert.ok(!line.includes('[#'))
    assert.ok(line.includes('老王: 报销流程是不是改了？'))
  })

  it('renders [#id] prefix when includeMessageId is enabled', () => {
    const line = formatMessageCompact(message, 'zh-CN', { includeMessageId: true })
    assert.ok(line.includes('[#1021]'))
  })

  it('marks search hits with [#id*]', () => {
    const line = formatMessageCompact(message, 'zh-CN', { includeMessageId: true, hitIds: new Set([1021]) })
    assert.ok(line.includes('[#1021*]'))
  })

  it('renders merged blocks as [#start-end] range', () => {
    const merged = { ...message, id: 1023, mergedEndId: 1025, content: '那之前提交的怎么办\n找财务问了' }
    const line = formatMessageCompact(merged, 'zh-CN', { includeMessageId: true })
    assert.ok(line.includes('[#1023-1025]'))
  })

  it('omits prefix when id is missing even if includeMessageId set', () => {
    const line = formatMessageCompact({ ...message, id: undefined }, 'zh-CN', { includeMessageId: true })
    assert.ok(!line.includes('[#'))
  })

  it('honors maxContentLength override and 0 disables truncation', () => {
    const long = { ...message, content: 'x'.repeat(500) }
    const short = formatMessageCompact(long, 'zh-CN', { maxContentLength: 10 })
    assert.ok(short.includes('x'.repeat(10) + '...'))
    assert.ok(!short.includes('x'.repeat(11)))
    const full = formatMessageCompact(long, 'zh-CN', { maxContentLength: 0 })
    assert.ok(full.includes('x'.repeat(500)))
    const default200 = formatMessageCompact(long, 'zh-CN')
    assert.ok(default200.includes('x'.repeat(200) + '...'))
  })
})

describe('applyPreprocessingPipeline CLI extensions', () => {
  const messagesWithIds: PreprocessableMessage[] = [
    { id: 1021, senderName: '老王', content: '报销流程是不是改了？', timestamp: 1710000000 },
    { id: 1022, senderName: '小红', content: '对，三月起走新系统', timestamp: 1710000060 },
  ]

  it('threads includeMessageIds and hitIds into the rendered text', () => {
    const result = applyPreprocessingPipeline({
      rawMessages: messagesWithIds,
      includeMessageIds: true,
      hitIds: [1021],
    })
    assert.ok(result.text.includes('[#1021*]'))
    assert.ok(result.text.includes('[#1022]'))
  })

  it('keeps default output free of id markers and exposes pipeline stats', () => {
    const result = applyPreprocessingPipeline({ rawMessages: messagesWithIds })
    assert.ok(!result.text.includes('[#'))
    assert.equal(result.stats.input, 2)
    assert.equal(result.stats.renderedBlocks, 2)
    assert.equal(result.stats.truncated, false)
  })

  it('applies maxContentChars to each rendered line', () => {
    const result = applyPreprocessingPipeline({
      rawMessages: [{ id: 1, senderName: 'A', content: 'y'.repeat(400), timestamp: 1710000000 }],
      maxContentChars: 50,
    })
    assert.ok(result.text.includes('y'.repeat(50) + '...'))
    assert.ok(!result.text.includes('y'.repeat(51)))
  })
})
