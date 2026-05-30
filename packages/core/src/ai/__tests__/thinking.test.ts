import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSupportedThinkingLevels, getThinkingCompat, isReasoningModel } from '../thinking'

describe('isReasoningModel', () => {
  it('returns false for anthropic provider (out of scope)', () => {
    assert.equal(isReasoningModel('anthropic', 'claude-opus-4-6'), false)
  })

  it('returns true for gemini 2.5+ reasoning models', () => {
    assert.equal(isReasoningModel('gemini', 'gemini-2.5-pro'), true)
    assert.equal(isReasoningModel('gemini', 'gemini-2.5-flash-preview-05-20'), true)
    assert.equal(isReasoningModel('gemini', 'gemini-3-flash'), true)
  })

  it('returns false for older gemini models', () => {
    assert.equal(isReasoningModel('gemini', 'gemini-2.0-flash'), false)
    assert.equal(isReasoningModel('gemini', 'gemini-1.5-pro'), false)
  })

  it('returns true for qwen provider', () => {
    assert.equal(isReasoningModel('qwen', 'qwen3-max'), true)
  })

  it('returns true for deepseek v4 model', () => {
    assert.equal(isReasoningModel('deepseek', 'deepseek-v4-pro'), true)
  })

  it('returns true for deepseek hybrid (v3.x / chat)', () => {
    assert.equal(isReasoningModel('deepseek', 'deepseek-chat'), true)
    assert.equal(isReasoningModel('deepseek', 'deepseek-v3.1'), true)
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

  it('returns false for models with -non-reasoning suffix', () => {
    assert.equal(isReasoningModel('xai', 'grok-4-fast-non-reasoning'), false)
  })

  it('returns true for hunyuan reasoning models', () => {
    assert.equal(isReasoningModel('hunyuan', 'hunyuan-t1-latest'), true)
    assert.equal(isReasoningModel('tencent', 'hunyuan-a13b'), true)
  })

  it('returns true for known reasoning model families', () => {
    assert.equal(isReasoningModel('minimax', 'minimax-m2'), true)
    assert.equal(isReasoningModel('baichuan', 'baichuan-m3'), true)
    assert.equal(isReasoningModel('mistral', 'mistral-small-2603'), true)
    assert.equal(isReasoningModel('step', 'step-3'), true)
    assert.equal(isReasoningModel('google', 'gemma-4-27b'), true)
    assert.equal(isReasoningModel('perplexity', 'sonar-deep-research'), true)
    assert.equal(isReasoningModel('xiaomi', 'mimo-v2-flash'), true)
    assert.equal(isReasoningModel('bytedance', 'seed-oss-36b'), true)
  })

  it('returns true for kimi k2.5+ models', () => {
    assert.equal(isReasoningModel('kimi', 'kimi-k2.5'), true)
    assert.equal(isReasoningModel('kimi', 'kimi-k3'), true)
  })

  it('returns true for grok reasoning variants', () => {
    assert.equal(isReasoningModel('xai', 'grok-3-mini'), true)
    assert.equal(isReasoningModel('xai', 'grok-4'), true)
    assert.equal(isReasoningModel('xai', 'grok-4-fast'), true)
    assert.equal(isReasoningModel('xai', 'grok-build'), true)
  })
})

describe('getSupportedThinkingLevels', () => {
  it('returns [] for non-reasoning models', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'gpt-4o'), [])
  })

  it('returns [] for anthropic (out of scope)', () => {
    assert.deepEqual(getSupportedThinkingLevels('anthropic', 'claude-opus-4-6'), [])
  })

  it('always includes default as first option for reasoning models', () => {
    const levels = getSupportedThinkingLevels('qwen', 'qwen3-max')
    assert.equal(levels[0], 'default')
  })

  it('returns default+off+high for qwen (on/off only)', () => {
    assert.deepEqual(getSupportedThinkingLevels('qwen', 'qwen3-max'), ['default', 'off', 'high'])
  })

  it('returns default+off+high for glm (same as qwen)', () => {
    assert.deepEqual(getSupportedThinkingLevels('glm', 'glm-5'), ['default', 'off', 'high'])
  })

  it('returns default+off+high+xhigh for deepseek-v4', () => {
    assert.deepEqual(getSupportedThinkingLevels('deepseek', 'deepseek-v4-pro'), ['default', 'off', 'high', 'xhigh'])
  })

  it('returns default+off+auto for deepseek hybrid', () => {
    assert.deepEqual(getSupportedThinkingLevels('deepseek', 'deepseek-chat'), ['default', 'off', 'auto'])
  })

  it('returns default+low+medium+high for o-series (cannot disable)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'o3'), ['default', 'low', 'medium', 'high'])
  })

  it('returns full range with default for gpt-5.2+', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'gpt-5.2'), [
      'default',
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('returns default+minimal+low+medium+high for gpt-5 base (cannot disable)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai', 'gpt-5'), ['default', 'minimal', 'low', 'medium', 'high'])
  })

  it('returns default+off+high for self-hosted qwen3 (qwen type)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai-compatible', 'qwen3:8b'), ['default', 'off', 'high'])
  })

  it('returns default+off+auto+low+medium+high for kimi thinking models', () => {
    assert.deepEqual(getSupportedThinkingLevels('kimi', 'kimi-k2-thinking'), [
      'default',
      'off',
      'auto',
      'low',
      'medium',
      'high',
    ])
  })

  it('returns default+off+auto+high for doubao seed', () => {
    assert.deepEqual(getSupportedThinkingLevels('doubao', 'doubao-seed-2-0-pro-260215'), [
      'default',
      'off',
      'auto',
      'high',
    ])
  })

  it('returns default+low+high for grok (cannot disable)', () => {
    assert.deepEqual(getSupportedThinkingLevels('xai', 'grok-4'), ['default', 'low', 'high'])
  })

  it('returns default+off+high for hunyuan', () => {
    assert.deepEqual(getSupportedThinkingLevels('hunyuan', 'hunyuan-t1-latest'), ['default', 'off', 'high'])
  })

  it('returns default+off+low+medium+high for gemini 2.5+', () => {
    assert.deepEqual(getSupportedThinkingLevels('gemini', 'gemini-2.5-flash-preview-05-20'), [
      'default',
      'off',
      'low',
      'medium',
      'high',
    ])
    assert.deepEqual(getSupportedThinkingLevels('gemini', 'gemini-3-pro'), ['default', 'off', 'low', 'medium', 'high'])
  })

  it('returns empty for older gemini models', () => {
    assert.deepEqual(getSupportedThinkingLevels('gemini', 'gemini-2.0-flash'), [])
  })

  it('returns default+off+auto for mimo (deepseek_hybrid type)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai-compatible', 'mimo-v2-flash'), ['default', 'off', 'auto'])
  })

  it('returns default+off+low+medium+high for generic reasoning (fallback)', () => {
    assert.deepEqual(getSupportedThinkingLevels('openai-compatible', 'some-reasoning-model'), [
      'default',
      'off',
      'low',
      'medium',
      'high',
    ])
  })
})

describe('getThinkingCompat', () => {
  it('returns {} for non-reasoning model', () => {
    assert.deepEqual(getThinkingCompat('openai', 'gpt-4o'), {})
  })

  it('returns thinkingFormat:qwen for qwen provider', () => {
    assert.deepEqual(getThinkingCompat('qwen', 'qwen3-max'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:qwen for glm', () => {
    assert.deepEqual(getThinkingCompat('glm', 'glm-5'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:qwen for hunyuan', () => {
    assert.deepEqual(getThinkingCompat('tencent', 'hunyuan-a13b'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:qwen for self-hosted qwen3', () => {
    assert.deepEqual(getThinkingCompat('openai-compatible', 'qwen3:8b'), { thinkingFormat: 'qwen' })
  })

  it('returns thinkingFormat:deepseek + thinkingLevelMap for deepseek-v4', () => {
    const compat = getThinkingCompat('deepseek', 'deepseek-v4-pro')
    assert.equal(compat.thinkingFormat, 'deepseek')
    assert.equal(compat.supportsReasoningEffort, undefined)
    assert.equal(compat.thinkingLevelMap?.high, 'high')
    assert.equal(compat.thinkingLevelMap?.xhigh, 'max')
    assert.equal(compat.thinkingLevelMap?.minimal, null)
  })

  it('returns thinkingFormat:deepseek + auto mapping for deepseek hybrid', () => {
    const compat = getThinkingCompat('deepseek', 'deepseek-chat')
    assert.equal(compat.thinkingFormat, 'deepseek')
    assert.equal(compat.thinkingLevelMap?.auto, 'auto')
    assert.equal(compat.thinkingLevelMap?.high, 'high')
    assert.equal(compat.thinkingLevelMap?.xhigh, null)
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

  it('returns supportsReasoningEffort + auto/off mappings for kimi', () => {
    const compat = getThinkingCompat('kimi', 'kimi-k2-thinking')
    assert.equal(compat.supportsReasoningEffort, true)
    assert.equal(compat.thinkingLevelMap?.auto, 'auto')
    assert.equal(compat.thinkingLevelMap?.off, 'none')
  })

  it('returns supportsReasoningEffort + auto mapping for doubao', () => {
    const compat = getThinkingCompat('doubao', 'doubao-seed-2-0-pro-260215')
    assert.equal(compat.supportsReasoningEffort, true)
    assert.equal(compat.thinkingLevelMap?.auto, 'auto')
    assert.equal(compat.thinkingLevelMap?.high, 'high')
  })

  it('returns thinkingFormat:deepseek for mimo/minimax/seed-oss (thinking:{type} format)', () => {
    const compat = getThinkingCompat('openai-compatible', 'mimo-v2-flash')
    assert.equal(compat.thinkingFormat, 'deepseek')
    assert.equal(compat.thinkingLevelMap?.auto, 'auto')
    assert.equal(compat.thinkingLevelMap?.high, 'high')

    const compat2 = getThinkingCompat('minimax', 'minimax-m2')
    assert.equal(compat2.thinkingFormat, 'deepseek')
  })
})
