import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MAX_TOOL_ROUNDS } from '../constants'

describe('Agent defaults', () => {
  it('uses 10 tool rounds by default', () => {
    assert.equal(DEFAULT_MAX_TOOL_ROUNDS, 10)
  })
})
