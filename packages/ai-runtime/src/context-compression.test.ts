import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveRuntimeContextWindow } from './context-compression'

describe('resolveRuntimeContextWindow', () => {
  it('uses only exact provider matches and a conservative fallback for custom endpoints', () => {
    assert.equal(resolveRuntimeContextWindow('deepseek', 'deepseek-v4-flash'), 1_000_000)
    assert.equal(resolveRuntimeContextWindow('openai-compatible', 'gpt-5'), 8_192)
    assert.equal(resolveRuntimeContextWindow('openai-compatible', 'custom-model'), 8_192)
  })
})
