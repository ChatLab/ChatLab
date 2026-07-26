import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resetProviderFields } from './model-config-form'

describe('resetProviderFields', () => {
  it('clears DeepSeek fields when switching to an OpenAI-compatible provider', () => {
    const form = { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }

    resetProviderFields(form, 'openai-compatible')

    assert.deepEqual(form, { baseURL: '', model: '' })
  })

  it('replaces custom fields when switching to DeepSeek', () => {
    const form = { baseURL: 'https://llm.company.test/v1', model: 'custom-model' }

    resetProviderFields(form, 'deepseek')

    assert.deepEqual(form, { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' })
  })
})
