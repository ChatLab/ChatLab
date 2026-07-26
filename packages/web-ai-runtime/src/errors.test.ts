import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeWebAIError } from './errors'

describe('normalizeWebAIError', () => {
  it('maps provider and browser transport failures to stable UI error codes', () => {
    assert.equal(normalizeWebAIError({ statusCode: 401, message: 'unauthorized' }).data.code, 'AUTH')
    assert.equal(normalizeWebAIError({ status: 429, message: 'too many requests' }).data.code, 'RATE_LIMIT')
    assert.equal(normalizeWebAIError({ status: 404, message: 'missing model' }).data.code, 'MODEL_NOT_FOUND')
    assert.equal(normalizeWebAIError(new TypeError('Failed to fetch')).data.code, 'NETWORK_OR_CORS')
    assert.equal(normalizeWebAIError(new Error('request timed out')).data.code, 'TIMEOUT')
  })
})
