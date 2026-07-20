import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WebRuntimeError } from '../runtime-error'
import { normalizeOpfsPoolInitializationError } from './opfs'

describe('normalizeOpfsPoolInitializationError', () => {
  it('maps an occupied OPFS access handle to a stable runtime error', () => {
    const cause = new DOMException(
      'Access Handles cannot be created if there is another open Access Handle',
      'NoModificationAllowedError'
    )

    const error = normalizeOpfsPoolInitializationError(cause)

    assert.ok(error instanceof WebRuntimeError)
    assert.equal(error.code, 'OPFS_WORKSPACE_BUSY')
    assert.match(error.message, /another Web WASM tab/i)
    assert.equal(error.cause, cause)
  })

  it('preserves unrelated initialization errors', () => {
    const cause = new Error('unexpected failure')

    assert.equal(normalizeOpfsPoolInitializationError(cause), cause)
  })
})
