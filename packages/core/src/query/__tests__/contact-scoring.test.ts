/**
 * Tests for pure contact scoring and tiering helpers.
 *
 * Run: pnpm test -- packages/core/src/query/__tests__/contact-scoring.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_NON_FRIEND_INTERACTIONS_FOR_HIGH,
  MIN_NON_FRIENDS_FOR_TIERS,
  MIN_PRIVATE_MESSAGES_FOR_CORE,
  applyContactOverride,
  assignFriendTiers,
  assignNonFriendTiers,
  computeFriendScores,
  computeNonFriendScores,
  computePrivateRegularity,
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

  it('assigns friend tiers by top 20, next 50, and last 30 percent cuts', () => {
    const contacts = Array.from({ length: 10 }, (_, index) => ({
      key: `friend-${index}`,
      score: 10 - index,
      privateMessageCount: MIN_PRIVATE_MESSAGES_FOR_CORE,
    }))

    const result = assignFriendTiers(contacts)

    assert.equal(result.grouped, true)
    assert.deepEqual(
      contacts.map((contact) => result.tiers.get(contact)),
      ['core', 'core', 'friend', 'friend', 'friend', 'friend', 'friend', 'acquaintance', 'acquaintance', 'acquaintance']
    )
  })

  it('clamps low-message friends out of core without promoting low-ranked contacts', () => {
    const contacts = Array.from({ length: 10 }, (_, index) => ({
      key: `friend-${index}`,
      score: 10 - index,
      privateMessageCount:
        index === 0 || index === 9 ? MIN_PRIVATE_MESSAGES_FOR_CORE - 1 : MIN_PRIVATE_MESSAGES_FOR_CORE,
    }))

    const result = assignFriendTiers(contacts)

    assert.equal(result.tiers.get(contacts[0]), 'friend')
    assert.equal(result.tiers.get(contacts[9]), 'acquaintance')
  })

  it('assigns non-friend tiers, clamps weak high interactions, and supports ungrouped small pools', () => {
    const contacts = Array.from({ length: MIN_NON_FRIENDS_FOR_TIERS }, (_, index) => ({
      key: `non-friend-${index}`,
      score: MIN_NON_FRIENDS_FOR_TIERS - index,
      coOccurrenceCount: index === 0 ? MIN_NON_FRIEND_INTERACTIONS_FOR_HIGH - 2 : MIN_NON_FRIEND_INTERACTIONS_FOR_HIGH,
      replyInteractionCount: index === 0 ? 1 : 0,
    }))

    const grouped = assignNonFriendTiers(contacts)

    assert.equal(grouped.grouped, true)
    assert.equal(grouped.tiers.get(contacts[0]), 'medium_interaction')
    assert.equal(grouped.tiers.get(contacts[1]), 'high_interaction')
    assert.equal(grouped.tiers.get(contacts[7]), 'low_interaction')

    const smallPool = assignNonFriendTiers(contacts.slice(0, MIN_NON_FRIENDS_FOR_TIERS - 1))
    assert.equal(smallPool.grouped, false)
    assert.deepEqual(
      contacts.slice(0, MIN_NON_FRIENDS_FOR_TIERS - 1).map((contact) => smallPool.tiers.get(contact)),
      Array.from({ length: MIN_NON_FRIENDS_FOR_TIERS - 1 }, () => 'medium_interaction')
    )
  })

  it('applies manual locked tiers over algorithm tiers', () => {
    assert.deepEqual(applyContactOverride('friend', { lockedTier: 'core' }), {
      tier: 'core',
      algorithmTier: 'friend',
      lockedTier: 'core',
    })
    assert.deepEqual(applyContactOverride('core', { lockedTier: null }), {
      tier: 'core',
      algorithmTier: 'core',
      lockedTier: null,
    })
  })
})
