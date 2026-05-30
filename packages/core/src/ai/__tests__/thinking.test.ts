import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSupportedThinkingLevels, getThinkingCompat, isReasoningModel } from '../thinking'

describe('isReasoningModel', () => {
  it('returns false for anthropic provider (out of scope v1)', () => {
    assert.equal(isReasoningModel('anthropic', 'claude-opus-4-6'), false)
  })

  it('returns false for gemini provider (out of scope v1)', () => {
    assert.equal(isReasoningModel('gemini', 'gemini-2.5-pro'), false)
  })

  it('returns true for qwen provider', () => {
    assert.equal(isReasoningModel('qwen', 'qwen3-max'), true)
  })

  it('returns true for deepseek v4 model', () => {
    assert.equal(isReasoningModel('deepseek', 'deepseek-v4-pro'), true)
  })

  it('returns true for openai o-series', () => {
    assert.equal(isReasoningModel('openai', 'o3'), true)
  })

  it('returns true for openai gpt-5.x', () => {
    assert.equal(isReasoningModel('openai', 'gpt-5.2'), true)
  })

  it('returns true for self-hosted qwen3 (heuristic)', () => {
    assert.equal(isReasoningModel('openai-compatible', 'qwen3:8b'), true)
  })

  it('returns false for non-reasoning model (gpt-4o)', () => {
    assert.equal(isReasoningModel('openai', 'gpt-4o'), false)
  })
})

describe('getSupportedThinkingLevels', () => {
  it('returns [] for non-reasoning models', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'gpt-4o'), [])
  })

  it('returns [] for anthropic (out of scope v1)', () => {
    assert.deepEqual(getSupportedThinkingLevels('anthropic', 'claude-opus-4-6'), [])
  })

  it('returns off+high for qwen (on/off only)', () => {
    assert.deepEqual(getSupportedThinkingLevels('qwen', 'qwen3-max'), ['off', 'high'])
  })

  it('returns off+high for glm (zai, same as qwen)', () => {
    assert.deepEqual(getSupportedThinkingLevels('glm', 'glm-5'), ['off', 'high'])
  })

  it('returns off+high+xhigh for deepseek-v4', () => {
    assert.deepEqual(getSupportedThinkingLevels('deepseek', 'deepseek-v4-pro'), ['off', 'high', 'xhigh'])
  })

  it('returns low+medium+high for o-series (cannot disable)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'o3'), ['low', 'medium', 'high'])
  })

  it('returns full range for gpt-5.2+', () => {
    assert.deepEqual(
      getSupportedThinkingLevels('openai', 'gpt-5.2'),
      ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    )
  })

  it('returns minimal+low+medium+high for gpt-5 base (cannot disable)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'gpt-5'), ['minimal', 'low', 'medium', 'high'])
  })

  it('returns off+high for self-hosted qwen3 (qwen type)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai-compatible', 'qwen3:8b'), ['off', 'high'])
  })

  it('returns low+medium+high for kimi thinking models', () => {
    assert.deepEqual(getSupportedThinkingLevels('kimi', 'kimi-k2-thinking'), ['low', 'medium', 'high'])
  })

  it('returns high only for doubao seed (no disable support)', () => {
    assert.deepEqual(getSupportedThinkingLevels('doubao', 'doubao-seed-2-0-pro-260215'), ['high'])
  })

  it('returns low+high for grok (cannot disable)', () => {
    assert.deepEqual(getSupportedThinkingLevels('xai', 'grok-4'), ['low', 'high'])
  })
})

describe('getThinkingCompat', () => {
  it('returns {} for non-reasoning model', () => {
    assert.deepEqual(getThinkingCompat('openai', 'gpt-4o'), {})
  })

  it('returns thinkingFormat:qwen for qwen provider', () => {
    assert.deepEqual(getThinkingCompat('qwen', 'qwen3-max'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:qwen for glm (zai)', () => {
    assert.deepEqual(getThinkingCompat('glm', 'glm-5'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:qwen for self-hosted qwen3', () => {
    assert.deepEqual(getThinkingCompat('openai-compatible', 'qwen3:8b'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:deepseek + thinkingLevelMap for deepseek-v4 (KEY FIX)', () => {
    // DeepSeek needs thinkingFormat:'deepseek' so pi-ai sends thinking:{type:"disabled"}
    // when 'off' is selected — NOT the generic supportsReasoningEffort path.
    const compat = getThinkingCompat('deepseek', 'deepseek-v4-pro')
    assert.equal(compat.thinkingFormat, 'deepseek')
    assert.equal(compat.supportsReasoningEffort, undefined)
    assert.equal(compat.thinkingLevelMap?.high, 'high')
    assert.equal(compat.thinkingLevelMap?.xhigh, 'max')
    assert.equal(compat.thinkingLevelMap?.minimal, null)
  })

  it('returns supportsReasoningEffort for o-series', () => {
    const compat = getThinkingCompat('openai', 'o3')
    assert.equal(compat.supportsReasoningEffort, true)
    assert.equal(compat.thinkingLevelMap, undefined)
  })

  it('returns supportsReasoningEffort + off:none for gpt-5.1', () => {
    const compat = getThinkingCompat('openai', 'gpt-5.1')
    assert.equal(compat.supportsReasoningEffort, true)
    assert.equal(compat.thinkingLevelMap?.off, 'none')
  })

  it('returns supportsReasoningEffort + off:none + xhigh for gpt-5.2+', () => {
    const compat = getThinkingCompat('openai', 'gpt-5.2')
    assert.equal(compat.supportsReasoningEffort, true)
    assert.equal(compat.thinkingLevelMap?.off, 'none')
    assert.equal(compat.thinkingLevelMap?.xhigh, 'xhigh')
  })
})
