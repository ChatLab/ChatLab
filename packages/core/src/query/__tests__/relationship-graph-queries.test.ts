/**
 * Tests for single-session people relationship graph query helpers.
 *
 * Run: pnpm test -- packages/core/src/query/__tests__/relationship-graph-queries.test.ts
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getGroupRelationshipGraphFacts, resolveOwnerMember } from '../contact-queries'
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
        (99, 'system', 'System', NULL, '[]', NULL);
    `)
    db = new Adapter(raw)
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

    assert.deepEqual(
      facts.members.map((member) => member.contact.platformId),
      ['alice-pid', 'bob-pid', 'carol-pid']
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

    assert.deepEqual(
      facts.members.map((member) => [member.contact.platformId, member.messageCount]),
      [
        ['alice-pid', 1],
        ['bob-pid', 0],
        ['carol-pid', 0],
      ]
    )
    assert.equal(facts.edges.length, 0)
  })
})
