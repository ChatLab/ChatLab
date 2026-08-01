import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_TOOL_RESULT_PERCENT, normalizeMaxToolResultPercent } from './promptConfigLimits'

describe('AIPromptConfigTab tool result budget controls', () => {
  it('allows users to raise tool result budget up to 80 percent', () => {
    assert.equal(MAX_TOOL_RESULT_PERCENT, 80)
    assert.equal(normalizeMaxToolResultPercent(80), 80)
    assert.equal(normalizeMaxToolResultPercent(81), 80)
  })
})
