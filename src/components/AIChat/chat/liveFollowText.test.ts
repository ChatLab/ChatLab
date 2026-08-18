import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getFirstLine, getLatestLine } from './liveFollowText'

describe('live follow text', () => {
  it('uses the first line after thinking settles', () => {
    assert.equal(getFirstLine('Inspect the session\nNewest reasoning tokens'), 'Inspect the session')
    assert.equal(getFirstLine('one-liner'), 'one-liner')
  })

  it('follows the latest streaming line, including a line that is still growing', () => {
    assert.equal(getLatestLine('Inspect the session\nNewest reasoning tokens'), 'Newest reasoning tokens')
    assert.equal(
      getLatestLine('Inspect the session\nNewest reasoning tokens keep arriving'),
      'Newest reasoning tokens keep arriving'
    )
    assert.equal(
      getLatestLine('Inspect the session\nNewest reasoning tokens keep arriving\n'),
      'Newest reasoning tokens keep arriving'
    )
  })
})
