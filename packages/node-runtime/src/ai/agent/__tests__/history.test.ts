/**
 * Tests for history replay (toPiHistoryMessages).
 *
 * Regression for: multi-turn conversations lost tool calls/results on reload,
 * causing the model to hallucinate instead of re-querying chat data.
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/agent/__tests__/history.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toPiHistoryMessages } from '../history'
import type { SimpleHistoryMessage } from '../types'
import type { ContentBlock } from '../../chats'

function toolBlock(overrides: Partial<Extract<ContentBlock, { type: 'tool' }>['tool']> = {}): ContentBlock {
  return {
    type: 'tool',
    tool: {
      name: 'search_messages',
      displayName: 'search_messages',
      status: 'done',
      params: { query: 'birthday' },
      toolCallId: 'call_abc',
      result: 'found 3 messages',
      ...overrides,
    },
  }
}

describe('toPiHistoryMessages — legacy plain history', () => {
  it('converts user/assistant text messages without contentBlocks', () => {
    const history: SimpleHistoryMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const out = toPiHistoryMessages(history)
    assert.equal(out.length, 2)
    assert.equal(out[0].role, 'user')
    assert.deepEqual(out[0].content, [{ type: 'text', text: 'hi' }])
    assert.equal(out[1].role, 'assistant')
    assert.equal(out[1].role === 'assistant' && out[1].stopReason, 'stop')
  })

  it('converts summary messages to assistant text', () => {
    const out = toPiHistoryMessages([{ role: 'summary', content: 'compressed context' }])
    assert.equal(out.length, 1)
    assert.equal(out[0].role, 'assistant')
    assert.deepEqual(out[0].content, [{ type: 'text', text: 'compressed context' }])
  })

  it('falls back to plain text when tool blocks lack persisted toolCallId/result (legacy rows)', () => {
    const history: SimpleHistoryMessage[] = [
      {
        role: 'assistant',
        content: 'I searched and found things.',
        contentBlocks: [
          { type: 'tool', tool: { name: 'search_messages', displayName: 'search', status: 'done' } },
          { type: 'text', text: 'I searched and found things.' },
        ],
      },
    ]
    const out = toPiHistoryMessages(history)
    assert.equal(out.length, 1)
    assert.equal(out[0].role, 'assistant')
    assert.deepEqual(out[0].content, [{ type: 'text', text: 'I searched and found things.' }])
  })
})

describe('toPiHistoryMessages — tool call replay', () => {
  it('replays persisted tool calls as toolCall/toolResult pairs with stable ids', () => {
    const history: SimpleHistoryMessage[] = [
      { role: 'user', content: 'what did we say about birthdays?' },
      {
        role: 'assistant',
        content: 'Let me search. Found it: March 3rd.',
        contentBlocks: [
          { type: 'text', text: 'Let me search. ' },
          toolBlock(),
          { type: 'text', text: 'Found it: March 3rd.' },
        ],
      },
    ]

    const out = toPiHistoryMessages(history)
    assert.equal(out.length, 4)

    const [, callMsg, resultMsg, finalMsg] = out
    assert.equal(callMsg.role, 'assistant')
    if (callMsg.role !== 'assistant') return
    assert.equal(callMsg.stopReason, 'toolUse')
    assert.deepEqual(callMsg.content, [
      { type: 'text', text: 'Let me search. ' },
      { type: 'toolCall', id: 'call_abc', name: 'search_messages', arguments: { query: 'birthday' } },
    ])

    assert.equal(resultMsg.role, 'toolResult')
    if (resultMsg.role !== 'toolResult') return
    assert.equal(resultMsg.toolCallId, 'call_abc')
    assert.equal(resultMsg.toolName, 'search_messages')
    assert.equal(resultMsg.isError, false)
    assert.deepEqual(resultMsg.content, [{ type: 'text', text: 'found 3 messages' }])

    assert.equal(finalMsg.role, 'assistant')
    if (finalMsg.role !== 'assistant') return
    assert.equal(finalMsg.stopReason, 'stop')
    assert.deepEqual(finalMsg.content, [{ type: 'text', text: 'Found it: March 3rd.' }])
  })

  it('replays the same toolCallId across repeated conversions (prompt cache stability)', () => {
    const history: SimpleHistoryMessage[] = [
      { role: 'assistant', content: 'x', contentBlocks: [toolBlock(), { type: 'text', text: 'x' }] },
    ]
    const ids = [toPiHistoryMessages(history), toPiHistoryMessages(history)].map((out) => {
      const call = out[0]
      if (call.role !== 'assistant') return undefined
      const item = call.content.find((c) => c.type === 'toolCall')
      return item?.type === 'toolCall' ? item.id : undefined
    })
    assert.equal(ids[0], 'call_abc')
    assert.equal(ids[0], ids[1])
  })

  it('every replayed toolCall has a matching toolResult immediately after it', () => {
    const history: SimpleHistoryMessage[] = [
      {
        role: 'assistant',
        content: 'multi tool',
        contentBlocks: [
          toolBlock({ toolCallId: 'call_1', result: 'r1' }),
          toolBlock({ toolCallId: 'call_2', name: 'get_recent_messages', result: 'r2' }),
          { type: 'text', text: 'done' },
        ],
      },
    ]
    const out = toPiHistoryMessages(history)
    for (let i = 0; i < out.length; i++) {
      const msg = out[i]
      if (msg.role !== 'assistant') continue
      const calls = msg.content.filter((c) => c.type === 'toolCall')
      if (calls.length === 0) continue
      assert.equal(calls.length, 1, 'one toolCall per replayed assistant message')
      const next = out[i + 1]
      assert.equal(next?.role, 'toolResult')
      if (next?.role === 'toolResult' && calls[0].type === 'toolCall') {
        assert.equal(next.toolCallId, calls[0].id)
      }
    }
  })

  it('maps error tool blocks to isError tool results', () => {
    const history: SimpleHistoryMessage[] = [
      {
        role: 'assistant',
        content: 'failed',
        contentBlocks: [
          toolBlock({ status: 'error', isError: true, result: 'Error: query too broad' }),
          { type: 'text', text: 'failed' },
        ],
      },
    ]
    const out = toPiHistoryMessages(history)
    const resultMsg = out.find((m) => m.role === 'toolResult')
    assert.ok(resultMsg && resultMsg.role === 'toolResult')
    assert.equal(resultMsg.isError, true)
  })

  it('skips unfinished tool blocks (running/aborted) so no toolCall is left unanswered', () => {
    const history: SimpleHistoryMessage[] = [
      {
        role: 'assistant',
        content: 'partial',
        contentBlocks: [
          toolBlock({ toolCallId: 'call_done', result: 'ok' }),
          toolBlock({ toolCallId: 'call_pending', status: 'running', result: undefined }),
          { type: 'text', text: 'partial' },
        ],
      },
    ]
    const out = toPiHistoryMessages(history)
    const callIds = out
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => (m.role === 'assistant' ? m.content : []))
      .filter((c) => c.type === 'toolCall')
      .map((c) => (c.type === 'toolCall' ? c.id : ''))
    assert.deepEqual(callIds, ['call_done'])
    const resultCount = out.filter((m) => m.role === 'toolResult').length
    assert.equal(resultCount, 1)
  })

  it('strips runtime-injected underscore params from replayed arguments', () => {
    const history: SimpleHistoryMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        contentBlocks: [
          toolBlock({ params: { query: 'a', _timeFilter: { startTs: 1, endTs: 2 } } }),
          { type: 'text', text: 'x' },
        ],
      },
    ]
    const out = toPiHistoryMessages(history)
    const call = out[0]
    assert.ok(call.role === 'assistant')
    const item = call.content.find((c) => c.type === 'toolCall')
    assert.ok(item && item.type === 'toolCall')
    assert.deepEqual(item.arguments, { query: 'a' })
  })

  it('truncates oversized persisted results at replay time', () => {
    const huge = 'x'.repeat(10000)
    const history: SimpleHistoryMessage[] = [
      { role: 'assistant', content: 'x', contentBlocks: [toolBlock({ result: huge }), { type: 'text', text: 'x' }] },
    ]
    const out = toPiHistoryMessages(history)
    const resultMsg = out.find((m) => m.role === 'toolResult')
    assert.ok(resultMsg && resultMsg.role === 'toolResult')
    const text = resultMsg.content[0]
    assert.ok(text.type === 'text')
    assert.ok(text.text.length < huge.length)
    assert.ok(text.text.endsWith('…[truncated]'))
  })

  it('replaces empty results with a placeholder and emits no trailing empty assistant message', () => {
    const history: SimpleHistoryMessage[] = [
      { role: 'assistant', content: 'x', contentBlocks: [{ type: 'text', text: 'x' }, toolBlock({ result: '' })] },
    ]
    const out = toPiHistoryMessages(history)
    const last = out[out.length - 1]
    assert.equal(last.role, 'toolResult')
    if (last.role === 'toolResult') {
      assert.deepEqual(last.content, [{ type: 'text', text: '(empty result)' }])
    }
    const emptyAssistant = out.some((m) => m.role === 'assistant' && m.content.length === 0)
    assert.equal(emptyAssistant, false)
  })

  it('does not replay think/chart/error blocks', () => {
    const history: SimpleHistoryMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        contentBlocks: [
          { type: 'think', tag: 'thinking', text: 'internal reasoning' },
          toolBlock(),
          { type: 'error', error: { name: 'E', message: 'boom', stack: null } },
          { type: 'text', text: 'x' },
        ],
      },
    ]
    const out = toPiHistoryMessages(history)
    const hasThinking = out.some(
      (m) => m.role === 'assistant' && m.content.some((c) => c.type !== 'text' && c.type !== 'toolCall')
    )
    assert.equal(hasThinking, false)
    const allText = JSON.stringify(out)
    assert.ok(!allText.includes('internal reasoning'))
    assert.ok(!allText.includes('boom'))
  })
})
