/**
 * Tests for shared AgentEventHandler.
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/agent/__tests__/event-handler.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AgentEventHandler, estimateTokensFromText } from '../event-handler'
import type { AgentStreamChunk } from '../event-handler'

describe('estimateTokensFromText', () => {
  it('returns 0 for empty text', () => {
    assert.equal(estimateTokensFromText(''), 0)
  })

  it('estimates latin text at ~4 chars per token', () => {
    const estimate = estimateTokensFromText('hello world, this is a test')
    assert.ok(estimate > 0)
    assert.ok(estimate < 20)
  })

  it('estimates CJK text at ~1 char per token', () => {
    const estimate = estimateTokensFromText('你好世界这是测试')
    assert.ok(estimate >= 8)
  })
})

describe('AgentEventHandler', () => {
  it('tracks tool usage on tool_start events', () => {
    const chunks: AgentStreamChunk[] = []
    const handler = new AgentEventHandler({
      onChunk: (c) => chunks.push(c),
      context: {},
      systemPrompt: 'test',
    })

    handler.handleCoreEvent(
      { type: 'tool_start', toolCallId: 'call_1', toolName: 'search', toolParams: { q: 'test' } },
      []
    )
    assert.deepEqual(handler.toolsUsed, ['search'])

    const startChunk = chunks.find((c) => c.type === 'tool_start')
    assert.equal(startChunk?.toolCallId, 'call_1')
  })

  it('updates tool rounds on turn_end', () => {
    const handler = new AgentEventHandler({
      onChunk: () => {},
      context: {},
      systemPrompt: 'test',
    })

    handler.handleCoreEvent({ type: 'turn_end', round: 3, hadToolCalls: true }, [])
    assert.equal(handler.toolRounds, 3)
  })

  it('cloneUsage returns independent copy', () => {
    const handler = new AgentEventHandler({
      onChunk: () => {},
      context: {},
      systemPrompt: 'test',
    })

    handler.handleCoreEvent(
      { type: 'usage_update', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
      []
    )

    const usage = handler.cloneUsage()
    assert.equal(usage.totalTokens, 150)

    handler.handleCoreEvent(
      { type: 'usage_update', usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } },
      []
    )
    assert.equal(usage.totalTokens, 150, 'clone should be independent')
  })

  it('normalizes tool params with context limits', () => {
    const handler = new AgentEventHandler({
      onChunk: () => {},
      context: { maxMessagesLimit: 10, timeFilter: { startTs: 100, endTs: 200 } },
      systemPrompt: 'test',
    })

    const params = handler.normalizeToolParams('search_messages', { query: 'test' })
    assert.equal(params.limit, 10)
    assert.deepEqual(params._timeFilter, { startTs: 100, endTs: 200 })
  })

  it('emits content chunks', () => {
    const chunks: AgentStreamChunk[] = []
    const handler = new AgentEventHandler({
      onChunk: (c) => chunks.push(c),
      context: {},
      systemPrompt: 'test',
    })

    handler.handleCoreEvent({ type: 'content', content: 'Hello' }, [])
    const contentChunks = chunks.filter((c) => c.type === 'content')
    assert.equal(contentChunks.length, 1)
    assert.equal(contentChunks[0].content, 'Hello')
  })

  it('passes chart tool results through unchanged', () => {
    const chunks: AgentStreamChunk[] = []
    const handler = new AgentEventHandler({
      onChunk: (c) => chunks.push(c),
      context: {},
      systemPrompt: 'test',
    })
    const toolResult = {
      content: 'Chart generated.',
      details: {
        chart: {
          version: 1,
          type: 'pie',
          title: 'Selected members',
          data: [{ label: 'Alice', value: 3 }],
          source: { rowCount: 1, truncated: false },
        },
      },
    }

    handler.handleCoreEvent(
      { type: 'tool_end', toolCallId: 'call_chart', toolName: 'render_chart', toolResult, isError: false },
      []
    )

    const resultChunk = chunks.find((c) => c.type === 'tool_result')
    assert.equal(resultChunk?.toolName, 'render_chart')
    assert.deepEqual(resultChunk?.toolResult, toolResult)
    assert.equal(resultChunk?.toolCallId, 'call_chart')
    assert.equal(resultChunk?.toolIsError, false)
  })
})
