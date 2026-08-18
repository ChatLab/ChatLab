import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Model } from '@earendil-works/pi-ai'

import { streamSimple } from '../pi-runtime'

it('returns a protocol error for API formats ChatLab does not expose', async () => {
  const model: Model<'unsupported-api'> = {
    id: 'unsupported-model',
    name: 'Unsupported Model',
    api: 'unsupported-api',
    provider: 'custom',
    baseUrl: 'http://localhost.invalid',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
  }

  const result = await streamSimple(model, { messages: [] }).result()

  assert.equal(result.stopReason, 'error')
  assert.equal(result.errorMessage, 'Unsupported ChatLab AI API format: unsupported-api')
})
