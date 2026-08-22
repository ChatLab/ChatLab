/**
 * Tests for single-session people relationship graph query helpers.
 *
 * Run: pnpm test -- packages/core/src/query/__tests__/relationship-graph-queries.test.ts
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  getGroupRelationshipGraphFacts,
  getParticipantSetInteractionFacts,
  resolveOwnerMember,
} from '../contact-queries'
import { accumulateSelectedCoOccurrencePairs } from '../advanced/social'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

class Stmt implements PreparedStatement {
  readonly?: boolean

  constructor(private stmt: Database.Statement) {
    this.readonly = stmt.readonly
  }

  get(...p: unknown[]) {
    return this.stmt.get(...p) as Record<string, unknown> | undefined
  }

  all(...p: unknown[]) {
    return this.stmt.all(...p) as Record<string, unknown>[]
  }

  run(...p: unknown[]): RunResult {
    const r = this.stmt.run(...p)
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
  }
}

class Adapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}

  exec(sql: string) {
    this.db.exec(sql)
  }

  prepare(sql: string) {
    return new Stmt(this.db.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  pragma(p: string) {
    return this.db.pragma(p)
  }

  close() {
    this.db.close()
  }
}

describe('relationship graph query helpers', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = new Database(':memory:', { nativeBinding })
    raw.exec(`
      CREATE TABLE meta (
        name TEXT,
        platform TEXT,
        type TEXT,
        imported_at INTEGER,
        owner_id TEXT
      );
      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT,
        account_name TEXT,
        group_nickname TEXT,
        aliases TEXT DEFAULT '[]',
        avatar TEXT
      );
      CREATE TABLE message (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER,
        ts INTEGER,
        type INTEGER,
        content TEXT,
        platform_message_id TEXT,
        reply_to_message_id TEXT
      );
      INSERT INTO meta (name, platform, type, imported_at, owner_id)
      VALUES ('Group', 'wechat', 'group', 1700000000, 'owner-pid');
      INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar) VALUES
        (1, 'owner-pid', 'Owner', NULL, '[]', NULL),
        (2, 'alice-pid', 'Alice', 'Alice G', '["Ally"]', 'alice.png'),
        (3, 'bob-pid', 'Bob', NULL, '[]', NULL),
        (4, 'carol-pid', 'Carol', NULL, '[]', NULL),
        (5, 'dave-pid', 'Dave', NULL, '[]', NULL),
        (99, 'system', 'System', NULL, '[]', NULL);
    `)
    db = new Adapter(raw)
  })

  it('retains only the strongest requested proximity anchors while scanning', () => {
    const pairs = accumulateSelectedCoOccurrencePairs(
      [
        { messageId: 1, senderId: 1, ts: 0 },
        { messageId: 2, senderId: 2, ts: 100 },
        { messageId: 3, senderId: 9, ts: 150 },
        { messageId: 4, senderId: 1, ts: 200 },
        { messageId: 5, senderId: 2, ts: 201 },
      ],
      [[1, 2]],
      { lookAhead: 1, maxAnchorsPerPair: 1 }
    )

    assert.deepEqual(
      pairs[0]?.anchors.map((anchor) => [anchor.messageId, anchor.relatedMessageId]),
      [[5, 4]]
    )
  })

  afterEach(() => {
    raw.close()
  })

  it('returns non-owner member nodes and real interaction edges from co-occurrence and replies', () => {
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 1, 1704103200, 0, 'owner starts', 'owner-1', null)
    insert.run(2, 2, 1704103201, 0, 'alice near bob', 'alice-1', null)
    insert.run(3, 3, 1704103202, 0, 'bob replies alice', 'bob-1', 'alice-1')
    insert.run(4, 4, 1704103900, 0, 'carol far away', 'carol-1', null)
    insert.run(5, 99, 1704103901, 80, 'system event', 'system-1', null)

    const facts = getGroupRelationshipGraphFacts(db, owner.id)

    assert.equal(facts.ownerMessageCount, 1)
    assert.deepEqual(
      facts.members.map((member) => member.contact.platformId),
      ['alice-pid', 'bob-pid', 'carol-pid', 'dave-pid']
    )
    assert.equal(
      facts.members.find((member) => member.contact.platformId === 'owner-pid'),
      undefined
    )
    const edge = facts.edges.find(
      (item) => item.source.platformId === 'alice-pid' && item.target.platformId === 'bob-pid'
    )
    assert.ok(edge)
    assert.ok(edge.coOccurrenceCount > 0)
    assert.equal(edge.replyInteractionCount, 1)
    assert.equal(edge.repliesFromTargetToSource, 1)
    assert.equal(edge.lastInteractionTs, 1704103202)
  })

  it('filters relationship graph facts by message start timestamp', () => {
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 2, 1600000000, 0, 'old alice', 'old-alice', null)
    insert.run(2, 3, 1600000001, 0, 'old bob', 'old-bob', 'old-alice')
    insert.run(3, 2, 1704103200, 0, 'new alice', 'new-alice', null)

    const facts = getGroupRelationshipGraphFacts(db, owner.id, { startTs: 1700000000 })

    assert.equal(facts.ownerMessageCount, 0)
    assert.deepEqual(
      facts.members.map((member) => [member.contact.platformId, member.messageCount]),
      [
        ['alice-pid', 1],
        ['bob-pid', 0],
        ['carol-pid', 0],
        ['dave-pid', 0],
      ]
    )
    assert.equal(facts.edges.length, 0)
  })

  it('returns exact participant activity, directional replies, co-active days, and evidence anchors', () => {
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 2, 1704067200, 0, 'alice day one', 'alice-1', null)
    insert.run(2, 3, 1704067260, 0, 'bob replies alice', 'bob-1', 'alice-1')
    insert.run(3, 3, 1704153600, 0, 'bob day two', 'bob-2', null)
    insert.run(4, 2, 1704153660, 0, 'alice replies bob', 'alice-2', 'bob-2')

    const facts = getParticipantSetInteractionFacts(db, [2, 3], { maxAnchorsPerPair: 4 })

    assert.deepEqual(
      facts.participants.map((participant) => [participant.memberId, participant.messageCount, participant.activeDays]),
      [
        [2, 2, 2],
        [3, 2, 2],
      ]
    )
    assert.deepEqual(facts.overlapRange, { startTs: 1704067260, endTs: 1704153600 })
    assert.equal(facts.allParticipantsCoActiveDays, 2)
    assert.equal(facts.proximityStatus, 'complete')
    assert.equal(facts.pairs.length, 1)
    const pair = facts.pairs[0]
    assert.equal(pair.directReplyCount, 2)
    assert.equal(pair.repliesFromSourceToTarget, 1)
    assert.equal(pair.repliesFromTargetToSource, 1)
    assert.equal(pair.coActiveDays, 2)
    assert.ok((pair.coOccurrenceCount ?? 0) > 0)
    assert.deepEqual(
      pair.anchors
        .filter((anchor) => anchor.signal === 'direct_reply')
        .map((anchor) => [anchor.messageId, anchor.relatedMessageId, anchor.fromMemberId, anchor.toMemberId]),
      [
        [4, 3, 2, 3],
        [2, 1, 3, 2],
      ]
    )
  })

  it('reports anchor truncation only when eligible evidence was omitted', () => {
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 2, 1704067200, 0, 'alice', 'alice-1', null)
    insert.run(2, 3, 1704067260, 0, 'bob', 'bob-1', null)

    const complete = getParticipantSetInteractionFacts(db, [2, 3], { maxAnchorsPerPair: 1 })
    assert.equal(complete.pairs[0].anchors.length, 1)
    assert.equal(complete.pairs[0].anchorsTruncated, false)

    const truncated = getParticipantSetInteractionFacts(db, [2, 3], { maxAnchorsPerPair: 0 })
    assert.equal(truncated.pairs[0].anchors.length, 0)
    assert.equal(truncated.pairs[0].anchorsTruncated, true)
  })

  it('filters interaction events by reply time while allowing an older referenced message', () => {
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 2, 1600000000, 0, 'old alice', 'old-alice', null)
    insert.run(2, 3, 1600000001, 0, 'old bob reply', 'old-bob', 'old-alice')
    insert.run(3, 2, 1700000000, 0, 'new alice', 'new-alice', null)
    insert.run(4, 3, 1700000001, 0, 'new bob replies old alice', 'new-bob', 'old-alice')
    insert.run(5, 2, 1700000002, 0, 'new alice replies bob', 'new-alice-2', 'new-bob')

    const facts = getParticipantSetInteractionFacts(db, [2, 3], {
      startTs: 1700000000,
      endTs: 1700000100,
      maxAnchorsPerPair: 4,
      maxProximityMessages: 1,
    })

    assert.equal(facts.proximityStatus, 'partial')
    assert.deepEqual(
      facts.participants.map((participant) => [participant.memberId, participant.messageCount]),
      [
        [2, 2],
        [3, 1],
      ]
    )
    assert.equal(facts.pairs[0].directReplyCount, 2)
    assert.deepEqual(
      facts.pairs[0].anchors
        .filter((anchor) => anchor.signal === 'direct_reply')
        .map((anchor) => [anchor.messageId, anchor.relatedMessageId]),
      [
        [5, 4],
        [4, 1],
      ]
    )
  })

  it('keeps non-selected speakers in the proximity window and marks budget-limited zeroes as unknown', () => {
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 2, 1704103200, 0, 'alice', 'alice-1', null)
    insert.run(2, 4, 1704103201, 0, 'carol', 'carol-1', null)
    insert.run(3, 1, 1704103202, 0, 'owner', 'owner-1', null)
    insert.run(4, 5, 1704103203, 0, 'dave', 'dave-1', null)
    insert.run(5, 3, 1704103204, 0, 'bob', 'bob-1', null)

    const complete = getParticipantSetInteractionFacts(db, [2, 3])
    assert.equal(complete.pairs[0].coOccurrenceCount, 0)

    const partial = getParticipantSetInteractionFacts(db, [2, 3], { maxProximityMessages: 1 })
    assert.equal(partial.proximityStatus, 'partial')
    assert.equal(partial.pairs[0].coOccurrenceCount, null)
    assert.equal(partial.pairs[0].coOccurrenceRawScore, null)
  })
})
