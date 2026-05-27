import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canReuseExistingApiKey } from './apiKeyReuse'

describe('canReuseExistingApiKey', () => {
  it('requires a new key after changing provider', () => {
    const result = canReuseExistingApiKey({
      mode: 'edit',
      existingApiKeySet: true,
      hasNewApiKey: false,
      originalProvider: 'openai',
      currentProvider: 'anthropic',
      originalConnectionMode: 'preset',
      currentConnectionMode: 'preset',
    })

    assert.equal(result, false)
  })

  it('allows reusing an existing key when provider and connection mode are unchanged', () => {
    const result = canReuseExistingApiKey({
      mode: 'edit',
      existingApiKeySet: true,
      hasNewApiKey: false,
      originalProvider: 'openai',
      currentProvider: 'openai',
      originalConnectionMode: 'preset',
      currentConnectionMode: 'preset',
    })

    assert.equal(result, true)
  })

  it('requires a new key after changing connection mode', () => {
    const result = canReuseExistingApiKey({
      mode: 'edit',
      existingApiKeySet: true,
      hasNewApiKey: false,
      originalProvider: 'openai-compatible',
      currentProvider: 'openai',
      originalConnectionMode: 'openai-compat',
      currentConnectionMode: 'preset',
    })

    assert.equal(result, false)
  })
})
