import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSemanticIndexModelConfig,
  canReuseSemanticIndexApiAuthProfile,
  isSemanticIndexApiKeyRequired,
} from './semantic-index-config-builder'
import type { SemanticIndexConfig } from '@/services'

const savedApiConfig: SemanticIndexConfig = {
  version: 1,
  enabled: true,
  mode: 'api',
  local: { modelId: 'old-local' },
  api: {
    baseUrl: 'https://api.example.com/v1',
    model: 'old-embed',
    authProfile: 'semantic-index-embedding',
  },
  searchMaxResults: 10,
}

describe('buildSemanticIndexModelConfig', () => {
  it('keeps existing API authProfile when reusing the same base URL without a new key', () => {
    const next = buildSemanticIndexModelConfig(savedApiConfig, {
      mode: 'api',
      localModelId: '',
      apiBaseUrl: 'https://api.example.com/v1',
      apiModel: 'new-embed',
      apiKey: '',
    })

    assert.equal(next.api?.authProfile, 'semantic-index-embedding')
    assert.equal(next.api?.model, 'new-embed')
  })

  it('does not reuse API authProfile after changing base URL without a new key', () => {
    const next = buildSemanticIndexModelConfig(savedApiConfig, {
      mode: 'api',
      localModelId: '',
      apiBaseUrl: 'https://other.example.com/v1',
      apiModel: 'new-embed',
      apiKey: '',
    })

    assert.equal(next.api?.authProfile, undefined)
  })

  it('does not allow UI key reuse when backend reports no saved key', () => {
    assert.equal(canReuseSemanticIndexApiAuthProfile(savedApiConfig, savedApiConfig.api!.baseUrl, false), false)
  })

  it('does not require an API key for local Ollama endpoints', () => {
    assert.equal(isSemanticIndexApiKeyRequired('http://localhost:11434/v1'), false)
    assert.equal(isSemanticIndexApiKeyRequired('http://127.0.0.1:11434/v1'), false)
    assert.equal(isSemanticIndexApiKeyRequired('https://api.openai.com/v1'), true)
  })
})
