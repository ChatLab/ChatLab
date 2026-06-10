import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PERSISTED_TOOL_RESULT_CHARS, extractToolResultText, truncateToolResultText } from '../tool-result-text'

describe('extractToolResultText', () => {
  it('joins text parts from AgentToolResult content', () => {
    const result = {
      content: [
        { type: 'text', text: 'line 1' },
        { type: 'image', data: 'xxx', mimeType: 'image/png' },
        { type: 'text', text: 'line 2' },
      ],
      details: { ignored: true },
    }
    assert.equal(extractToolResultText(result), 'line 1\nline 2')
  })

  it('returns empty string for non-object or malformed results', () => {
    assert.equal(extractToolResultText(null), '')
    assert.equal(extractToolResultText('plain string'), '')
    assert.equal(extractToolResultText({ content: 'not an array' }), '')
    assert.equal(extractToolResultText({ content: [{ type: 'text' }] }), '')
  })
})

describe('truncateToolResultText', () => {
  it('keeps short text unchanged', () => {
    assert.equal(truncateToolResultText('short'), 'short')
  })

  it('truncates oversized text with a marker', () => {
    const long = 'a'.repeat(MAX_PERSISTED_TOOL_RESULT_CHARS + 100)
    const truncated = truncateToolResultText(long)
    assert.ok(truncated.length <= MAX_PERSISTED_TOOL_RESULT_CHARS + 20)
    assert.ok(truncated.endsWith('…[truncated]'))
  })
})
