import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getProximityTimeFilter } from './group-relationship-filter'

describe('getProximityTimeFilter', () => {
  it('keeps time bounds but removes the member filter', () => {
    assert.deepEqual(getProximityTimeFilter({ startTs: 10, endTs: 20, memberId: 3 }), {
      startTs: 10,
      endTs: 20,
    })
  })

  it('returns no filter when only a member is selected', () => {
    assert.equal(getProximityTimeFilter({ memberId: 3 }), undefined)
    assert.equal(getProximityTimeFilter(), undefined)
  })
})
