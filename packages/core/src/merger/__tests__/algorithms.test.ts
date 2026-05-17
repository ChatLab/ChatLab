/**
 * Tests for merger pure algorithms.
 *
 * Run: npx tsx --test packages/core/src/merger/__tests__/algorithms.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCollidingPlatformIds,
  normalizePlatformId,
  detectConflictsInMessages,
  mergeMembers,
  deduplicateAndSortMessages,
  type MergerMessage,
} from '../algorithms'

describe('getCollidingPlatformIds', () => {
  it('detects IDs that appear in multiple platforms', () => {
    const result = getCollidingPlatformIds([
      { platform: 'qq', members: [{ platformId: 'user1' }, { platformId: 'user2' }] },
      { platform: 'wechat', members: [{ platformId: 'user1' }, { platformId: 'user3' }] },
    ])
    assert.ok(result.has('user1'))
    assert.ok(!result.has('user2'))
    assert.ok(!result.has('user3'))
  })

  it('returns empty set when no collisions', () => {
    const result = getCollidingPlatformIds([
      { platform: 'qq', members: [{ platformId: 'a' }] },
      { platform: 'wechat', members: [{ platformId: 'b' }] },
    ])
    assert.equal(result.size, 0)
  })
})

describe('normalizePlatformId', () => {
  it('returns original ID when not colliding', () => {
    const collidingIds = new Set<string>()
    assert.equal(normalizePlatformId('user1', 'qq', collidingIds), 'user1')
  })

  it('returns namespaced ID when colliding', () => {
    const collidingIds = new Set(['user1'])
    const result = normalizePlatformId('user1', 'qq', collidingIds)
    assert.ok(result.includes('__chatlab_platform__'))
    assert.ok(result.includes('qq'))
    assert.ok(result.includes('user1'))
  })

  it('produces different IDs for same platformId on different platforms', () => {
    const collidingIds = new Set(['user1'])
    const a = normalizePlatformId('user1', 'qq', collidingIds)
    const b = normalizePlatformId('user1', 'wechat', collidingIds)
    assert.notEqual(a, b)
  })
})

describe('detectConflictsInMessages', () => {
  it('detects conflicts for same sender/timestamp but different content from different files', () => {
    const msg = (content: string): MergerMessage => ({
      senderPlatformId: 'u1',
      timestamp: 100,
      type: 0,
      content,
    })
    const result = detectConflictsInMessages([
      { msg: msg('hello'), source: 'file1.txt', platform: 'qq' },
      { msg: msg('world'), source: 'file2.txt', platform: 'qq' },
    ])
    assert.equal(result.conflicts.length, 1)
    assert.equal(result.conflicts[0].content1, 'hello')
    assert.equal(result.conflicts[0].content2, 'world')
  })

  it('no conflicts when same content from different files', () => {
    const msg = (content: string): MergerMessage => ({
      senderPlatformId: 'u1',
      timestamp: 100,
      type: 0,
      content,
    })
    const result = detectConflictsInMessages([
      { msg: msg('same'), source: 'file1.txt', platform: 'qq' },
      { msg: msg('same'), source: 'file2.txt', platform: 'qq' },
    ])
    assert.equal(result.conflicts.length, 0)
  })

  it('counts unique messages after dedup', () => {
    const msg1: MergerMessage = { senderPlatformId: 'u1', timestamp: 100, type: 0, content: 'hello' }
    const msg2: MergerMessage = { senderPlatformId: 'u2', timestamp: 200, type: 0, content: 'world' }
    const result = detectConflictsInMessages([
      { msg: msg1, source: 'a', platform: 'qq' },
      { msg: msg1, source: 'b', platform: 'qq' },
      { msg: msg2, source: 'a', platform: 'qq' },
    ])
    assert.equal(result.totalMessages, 2)
  })
})

describe('mergeMembers', () => {
  it('merges members from multiple sources', () => {
    const result = mergeMembers(
      [
        { platform: 'qq', members: [{ platformId: 'u1', accountName: 'Alice' }] },
        {
          platform: 'qq',
          members: [
            { platformId: 'u1', groupNickname: 'A' },
            { platformId: 'u2', accountName: 'Bob' },
          ],
        },
      ],
      new Set()
    )
    assert.equal(result.size, 2)
    const u1 = result.get('u1')!
    assert.equal(u1.accountName, 'Alice')
    assert.equal(u1.groupNickname, 'A')
  })
})

describe('deduplicateAndSortMessages', () => {
  it('removes duplicates and sorts by timestamp', () => {
    const msg = (ts: number, content: string): MergerMessage => ({
      senderPlatformId: 'u1',
      timestamp: ts,
      type: 0,
      content,
    })
    const result = deduplicateAndSortMessages(
      [
        { platform: 'qq', messages: [msg(300, 'c'), msg(100, 'a')] },
        { platform: 'qq', messages: [msg(100, 'a'), msg(200, 'b')] },
      ],
      new Set()
    )
    assert.equal(result.length, 3)
    assert.equal(result[0].timestamp, 100)
    assert.equal(result[1].timestamp, 200)
    assert.equal(result[2].timestamp, 300)
  })
})
