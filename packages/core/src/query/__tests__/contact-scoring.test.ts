/**
 * Tests for pure contact scoring and visibility helpers.
 *
 * Run: pnpm test -- packages/core/src/query/__tests__/contact-scoring.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_NON_FRIEND_INTERACTIONS_FOR_VISIBLE,
  computeFriendScores,
  computeNonFriendScores,
  computePrivateRegularity,
  isLowSignalNonFriend,
  rankPercentiles,
} from '../contact-scoring'

describe('contact scoring helpers', () => {
  it('scores private message volume with log1p percentile and bounded components', () => {
    const contacts = [
      { key: 'quiet', privateMessageCount: 0, activeMonths: [], commonGroupCount: 0 },
      { key: 'medium', privateMessageCount: 9, activeMonths: ['2024-01'], commonGroupCount: 1 },
      { key: 'active', privateMessageCount: 99, activeMonths: ['2024-01', '2024-02'], commonGroupCount: 2 },
    ]

    const expectedMessageScores = rankPercentiles(contacts, (contact) => Math.log1p(contact.privateMessageCount))
    const scores = computeFriendScores(contacts)

    for (const contact of contacts) {
      const result = scores.get(contact)
      assert.ok(result)
      assert.equal(result.scoreBreakdown.privateMessageScore, expectedMessageScores.get(contact))
      assert.ok(result.score >= 0 && result.score <= 1)
      assert.ok((result.scoreBreakdown.privateMessageScore ?? -1) >= 0)
      assert.ok((result.scoreBreakdown.privateMessageScore ?? 2) <= 1)
      assert.ok((result.scoreBreakdown.privateRegularityScore ?? -1) >= 0)
      assert.ok((result.scoreBreakdown.privateRegularityScore ?? 2) <= 1)
      assert.ok((result.scoreBreakdown.commonGroupScore ?? -1) >= 0)
      assert.ok((result.scoreBreakdown.commonGroupScore ?? 2) <= 1)
    }
  })

  it('computes active-month regularity from active count and span ratio', () => {
    assert.equal(computePrivateRegularity(['2024-01', '2024-02', '2024-03']), 3)
    assert.equal(computePrivateRegularity(['2024-01', '2024-12']), 1 / 3)
    assert.equal(computePrivateRegularity(['2024-05']), 1)
    assert.ok(computePrivateRegularity(['2024-01', '2024-12']) < computePrivateRegularity(['2024-01', '2024-02']))
  })

  it('scores non-friends with co-occurrence, common groups, and reply interactions', () => {
    const contacts = [
      { key: 'low', coOccurrenceRawScore: 0, commonGroupCount: 1, replyInteractionCount: 0 },
      { key: 'group-overlap', coOccurrenceRawScore: 1, commonGroupCount: 5, replyInteractionCount: 1 },
      { key: 'interactive', coOccurrenceRawScore: 5, commonGroupCount: 2, replyInteractionCount: 8 },
    ]

    const scores = computeNonFriendScores(contacts)

    assert.ok(scores.get(contacts[2])!.score > scores.get(contacts[0])!.score)
    for (const contact of contacts) {
      const result = scores.get(contact)
      assert.ok(result)
      assert.ok(result.score >= 0 && result.score <= 1)
      assert.ok((result.scoreBreakdown.coOccurrenceScore ?? -1) >= 0)
      assert.ok((result.scoreBreakdown.coOccurrenceScore ?? 2) <= 1)
      assert.ok((result.scoreBreakdown.commonGroupScore ?? -1) >= 0)
      assert.ok((result.scoreBreakdown.commonGroupScore ?? 2) <= 1)
      assert.ok((result.scoreBreakdown.replyInteractionScore ?? -1) >= 0)
      assert.ok((result.scoreBreakdown.replyInteractionScore ?? 2) <= 1)
    }
  })

  it('identifies low-signal non-friends with an absolute interaction threshold', () => {
    assert.equal(
      isLowSignalNonFriend({
        coOccurrenceCount: MIN_NON_FRIEND_INTERACTIONS_FOR_VISIBLE - 2,
        replyInteractionCount: 1,
      }),
      true
    )
    assert.equal(
      isLowSignalNonFriend({
        coOccurrenceCount: MIN_NON_FRIEND_INTERACTIONS_FOR_VISIBLE,
        replyInteractionCount: 0,
      }),
      false
    )
  })
})
