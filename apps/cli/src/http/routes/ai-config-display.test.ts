import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toLlmConfigDisplay } from './ai-config-display'

describe('toLlmConfigDisplay', () => {
  it('marks apiKeySet when provider fallback auth resolves a key', () => {
    const result = toLlmConfigDisplay(
      {
        id: 'cfg-1',
        name: 'OpenAI compatible',
        provider: 'openai-compatible',
        apiKey: '',
      },
      (provider, authProfile) => (provider === 'openai-compatible' && !authProfile ? 'sk-provider-fallback' : '')
    )

    assert.equal(result.apiKey, '')
    assert.equal(result.apiKeySet, true)
  })

  it('does not mark the local no-key placeholder as a real API key', () => {
    const result = toLlmConfigDisplay(
      {
        id: 'cfg-2',
        name: 'LAN Ollama',
        provider: 'openai-compatible',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:11434',
        authProfile: 'lan-ollama',
      },
      () => 'sk-no-key-required'
    )

    assert.equal(result.apiKey, '')
    assert.equal(result.apiKeySet, false)
  })

  it('does not mark legacy plaintext apiKey as reusable', () => {
    const result = toLlmConfigDisplay(
      {
        id: 'cfg-3',
        name: 'Legacy OpenAI',
        provider: 'openai',
        apiKey: 'sk-legacy-plaintext',
      },
      () => ''
    )

    assert.equal(result.apiKey, '')
    assert.equal(result.apiKeySet, false)
  })
})
