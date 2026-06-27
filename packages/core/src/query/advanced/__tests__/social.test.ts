/**
 * Tests for shared social graph helpers.
 *
 * Run: pnpm test -- packages/core/src/query/advanced/__tests__/social.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accumulateCoOccurrencePairs } from '../social'

describe('social graph helpers', () => {
  it('tracks the latest timestamp for each co-occurrence pair', () => {
    const pairs = accumulateCoOccurrencePairs([
      { senderId: 1, ts: 1704103200 },
      { senderId: 2, ts: 1704103260 },
      { senderId: 1, ts: 1704103320 },
      { senderId: 2, ts: 1704103380 },
      { senderId: 3, ts: 1704107000 },
    ])

    const ownerAlice = pairs.find((pair) => pair.sourceId === 1 && pair.targetId === 2)

    assert.ok(ownerAlice)
    assert.equal(ownerAlice.lastOccurrenceTs, 1704103380)
  })

  it('uses unix seconds directly for co-occurrence decay', () => {
    const closePair = accumulateCoOccurrencePairs(
      [
        { senderId: 1, ts: 1704103200 },
        { senderId: 2, ts: 1704103260 },
      ],
      { decaySeconds: 120 }
    )[0]
    const distantPair = accumulateCoOccurrencePairs(
      [
        { senderId: 1, ts: 1704103200 },
        { senderId: 2, ts: 1704106800 },
      ],
      { decaySeconds: 120 }
    )[0]

    assert.ok(closePair)
    assert.ok(distantPair)
    assert.ok(closePair.rawScore > 0.6)
    assert.ok(distantPair.rawScore < 0.001)
  })
})
