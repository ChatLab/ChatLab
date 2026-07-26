import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveMessageLimit } from './limits'

describe('resolveMessageLimit', () => {
  it('normalizes positive finite limits to integers before applying the cap', () => {
    assert.equal(resolveMessageLimit(2.9, 100, 10), 2)
    assert.equal(resolveMessageLimit(0.5, 100, 10), 1)
    assert.equal(resolveMessageLimit(Number.POSITIVE_INFINITY, 100, 10), 10)
  })
})
