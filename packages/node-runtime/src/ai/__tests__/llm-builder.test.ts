import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPiModel, normalizeAnthropicBaseUrl, normalizeOpenAICompatibleBaseUrl } from '../llm-builder'

describe('normalizeAnthropicBaseUrl', () => {
  it('strips trailing /v1', () => {
    assert.equal(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1'), 'https://api.anthropic.com')
  })

  it('strips trailing /v1/', () => {
    assert.equal(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1/'), 'https://api.anthropic.com')
  })

  it('leaves URL without /v1 unchanged', () => {
    assert.equal(normalizeAnthropicBaseUrl('https://api.anthropic.com'), 'https://api.anthropic.com')
  })
})

describe('normalizeOpenAICompatibleBaseUrl', () => {
  it('appends /v1 when path is empty', () => {
    assert.equal(normalizeOpenAICompatibleBaseUrl('https://api.example.com'), 'https://api.example.com/v1')
  })

  it('appends /v1 when path is /', () => {
    assert.equal(normalizeOpenAICompatibleBaseUrl('https://api.example.com/'), 'https://api.example.com/v1')
  })

  it('does not append when already ends with /v1', () => {
    assert.equal(normalizeOpenAICompatibleBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1')
  })

  it('does not modify URLs with custom paths', () => {
    assert.equal(normalizeOpenAICompatibleBaseUrl('https://api.example.com/proxy'), 'https://api.example.com/proxy')
  })

  it('returns empty string for empty input', () => {
    assert.equal(normalizeOpenAICompatibleBaseUrl(''), '')
  })
})

describe('buildPiModel', () => {
  it('builds a Google Generative AI model', () => {
    const model = buildPiModel({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://generativelanguage.googleapis.com',
    })
    assert.equal(model.api, 'google-generative-ai')
    assert.equal(model.provider, 'google')
    assert.equal(model.id, 'gemini-2.0-flash')
  })

  it('builds an Anthropic model with normalized URL', () => {
    const model = buildPiModel({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com/v1',
    })
    assert.equal(model.api, 'anthropic-messages')
    assert.equal(model.baseUrl, 'https://api.anthropic.com')
  })

  it('builds an OpenAI model with default apiFormat', () => {
    const model = buildPiModel({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    })
    assert.equal(model.api, 'openai-completions')
  })

  it('normalizes openai-compatible URLs', () => {
    const model = buildPiModel({
      provider: 'openai-compatible',
      model: 'custom-model',
      baseUrl: 'https://my-gateway.example.com',
      apiFormat: 'openai-completions',
    })
    assert.equal(model.baseUrl, 'https://my-gateway.example.com/v1')
  })

  it('passes custom headers via options', () => {
    const model = buildPiModel(
      { provider: 'openai-compatible', model: 'test', baseUrl: 'https://test.com/v1' },
      { headers: { 'X-Custom': 'value' } }
    )
    assert.deepEqual(model.headers, { 'X-Custom': 'value' })
  })

  it('auto-infers reasoning=true for catalog models with reasoning capability', () => {
    // o3 is in the ChatLab catalog with capabilities: ['chat', 'reasoning', ...]
    const model = buildPiModel({
      provider: 'openai',
      model: 'o3',
      baseUrl: 'https://api.openai.com/v1',
    })
    assert.equal(model.reasoning, true)
    // o-series uses reasoning_effort without thinkingLevelMap
    assert.equal((model.compat as Record<string, unknown> | undefined)?.supportsReasoningEffort, true)
    assert.equal((model.compat as Record<string, unknown> | undefined)?.thinkingLevelMap, undefined)
  })

  it('auto-infers reasoning=false and compat=undefined for non-reasoning OpenAI model', () => {
    // gpt-4o is not a reasoning model; no enable_thinking should ever be injected
    const model = buildPiModel({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    })
    assert.equal(model.reasoning, false)
    assert.equal(model.compat, undefined)
  })

  it('auto-infers reasoning=true and compat.thinkingFormat=qwen for official qwen reasoning model', () => {
    // qwen3-max is in the qwen provider catalog with reasoning capability
    const model = buildPiModel({
      provider: 'qwen',
      model: 'qwen3-max',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    })
    assert.equal(model.reasoning, true)
    assert.deepEqual(model.compat, { thinkingFormat: 'qwen' })
  })

  it('auto-infers reasoning=true and compat.thinkingFormat=qwen for custom self-hosted qwen3 model', () => {
    // Custom model not in catalog — falls back to name heuristic
    const model = buildPiModel(
      { provider: 'openai-compatible', model: 'qwen3:8b', baseUrl: 'http://localhost:11434/v1' },
      { findModelFn: () => null }
    )
    assert.equal(model.reasoning, true)
    assert.deepEqual(model.compat, { thinkingFormat: 'qwen' })
  })

  it('auto-infers reasoning=false and compat=undefined for non-reasoning Anthropic model', () => {
    const model = buildPiModel({
      provider: 'openai-compatible',
      model: 'claude-3-5-sonnet',
      baseUrl: 'https://api.anthropic.com/v1',
    })
    assert.equal(model.reasoning, false)
    assert.equal(model.compat, undefined)
  })

  it('uses thinkingFormat:deepseek (not supportsReasoningEffort) for deepseek-v4', () => {
    const model = buildPiModel({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com/v1',
    })
    assert.equal(model.reasoning, true)
    const compat = model.compat as Record<string, unknown> | undefined
    // Must use thinkingFormat:'deepseek' so that 'off' sends thinking:{type:"disabled"}
    assert.equal(compat?.thinkingFormat, 'deepseek')
    assert.equal(compat?.supportsReasoningEffort, undefined)
    const map = compat?.thinkingLevelMap as Record<string, unknown> | undefined
    assert.equal(map?.high, 'high')
    assert.equal(map?.xhigh, 'max')
    assert.equal(map?.minimal, null)
  })

  it('uses custom findModelFn for context window', () => {
    const model = buildPiModel(
      { provider: 'openai', model: 'custom', baseUrl: 'https://api.openai.com/v1' },
      {
        findModelFn: (_providerId, _modelId) => ({
          id: 'custom',
          providerId: 'openai',
          name: 'Custom',
          contextWindow: 32000,
          capabilities: ['chat'] as const,
          recommendedFor: ['chat'] as const,
          status: 'stable' as const,
          builtin: false,
          editable: true,
        }),
      }
    )
    assert.equal(model.contextWindow, 32000)
  })
})
