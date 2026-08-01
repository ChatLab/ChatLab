import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canReuseExistingApiKey, type ApiKeyReuseInput } from './apiKeyReuse'

describe('canReuseExistingApiKey', () => {
  const presetInput: ApiKeyReuseInput = {
    mode: 'edit',
    existingApiKeySet: true,
    hasNewApiKey: false,
    originalProvider: 'openai',
    currentProvider: 'openai',
    originalConnectionMode: 'preset',
    currentConnectionMode: 'preset',
  }
  const compatInput: ApiKeyReuseInput = {
    ...presetInput,
    originalProvider: 'openai-compatible',
    currentProvider: 'openai-compatible',
    originalConnectionMode: 'openai-compat',
    currentConnectionMode: 'openai-compat',
    originalBaseUrl: 'https://api.provider-a.com',
    currentBaseUrl: 'https://api.provider-a.com',
  }

  const cases: Array<{
    name: string
    input: ApiKeyReuseInput
    expected: boolean
  }> = [
    {
      name: 'requires a new key after changing provider',
      input: { ...presetInput, currentProvider: 'anthropic' },
      expected: false,
    },
    {
      name: 'allows reusing an existing key when provider and connection mode are unchanged',
      input: presetInput,
      expected: true,
    },
    {
      name: 'requires a new key after changing connection mode',
      input: {
        ...compatInput,
        currentProvider: 'openai',
        currentConnectionMode: 'preset',
      },
      expected: false,
    },
    {
      name: 'requires a new key when base URL changes in openai-compat mode',
      input: { ...compatInput, currentBaseUrl: 'https://api.provider-b.com' },
      expected: false,
    },
    {
      name: 'allows reusing key when base URL is unchanged in openai-compat mode (trailing slash normalized)',
      input: { ...compatInput, originalBaseUrl: 'https://api.provider-a.com/' },
      expected: true,
    },
    {
      name: 'allows reusing key when base URL is unchanged in openai-compat mode',
      input: compatInput,
      expected: true,
    },
  ]

  for (const scenario of cases) {
    it(scenario.name, () => {
      assert.equal(canReuseExistingApiKey(scenario.input), scenario.expected)
    })
  }
})
