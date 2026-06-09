/**
 * Tests for DataSnapshot assembly.
 *
 * Run: npx tsx --test packages/node-runtime/src/ai/agent/__tests__/data-snapshot.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDataSnapshotFromOverview } from '../data-snapshot'

describe('createDataSnapshotFromOverview', () => {
  it('maps overview members and summary count into an extended data snapshot', () => {
    const snapshot = createDataSnapshotFromOverview({
      name: 'Team Chat',
      platform: 'wechat',
      type: 'group',
      totalMessages: 200,
      totalMembers: 3,
      firstMessageTs: 1735689600,
      lastMessageTs: 1767225599,
      summaryCount: 7,
      topMembers: [
        { id: 1, name: 'Alice', count: 120 },
        { id: 2, name: 'Bob', count: 80 },
      ],
    })

    assert.deepEqual(snapshot, {
      version: 2,
      name: 'Team Chat',
      platform: 'wechat',
      type: 'group',
      totalMessages: 200,
      totalMembers: 3,
      firstMessageTs: 1735689600,
      lastMessageTs: 1767225599,
      activeMemberHints: [
        { memberId: 1, displayName: 'Alice', messageCount: 120, share: 60 },
        { memberId: 2, displayName: 'Bob', messageCount: 80, share: 40 },
      ],
      segmentSummaries: { availableCount: 7 },
    })
  })

  it('keeps all supplied members for small groups and caps large groups at ten hints', () => {
    const topMembers = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      name: `Member ${index + 1}`,
      count: 10,
    }))

    const smallGroup = createDataSnapshotFromOverview({
      name: 'Small',
      platform: 'wechat',
      type: 'group',
      totalMessages: 120,
      totalMembers: 10,
      firstMessageTs: null,
      lastMessageTs: null,
      topMembers: topMembers.slice(0, 10),
    })
    const largeGroup = createDataSnapshotFromOverview({
      name: 'Large',
      platform: 'wechat',
      type: 'group',
      totalMessages: 120,
      totalMembers: 12,
      firstMessageTs: null,
      lastMessageTs: null,
      topMembers,
    })

    assert.ok(smallGroup?.activeMemberHints)
    assert.ok(largeGroup?.activeMemberHints)
    assert.equal(smallGroup.activeMemberHints.length, 10)
    assert.equal(largeGroup.activeMemberHints.length, 10)
    assert.equal(largeGroup.activeMemberHints.at(-1)?.memberId, 10)
  })

  it('returns a usable snapshot without member hints when overview has no topMembers', () => {
    const snapshot = createDataSnapshotFromOverview({
      name: 'No Cache',
      platform: 'wechat',
      type: 'group',
      totalMessages: 0,
      totalMembers: 0,
      firstMessageTs: null,
      lastMessageTs: null,
    })

    assert.ok(snapshot?.segmentSummaries)
    assert.equal(snapshot.segmentSummaries.availableCount, 0)
    assert.deepEqual(snapshot?.activeMemberHints, [])
  })

  it('returns undefined for missing overview', () => {
    assert.equal(createDataSnapshotFromOverview(null), undefined)
    assert.equal(createDataSnapshotFromOverview(undefined), undefined)
  })
})
