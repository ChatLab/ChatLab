/**
 * Tests for single-session contact query helpers.
 *
 * Run: pnpm test -- packages/core/src/query/__tests__/contact-queries.test.ts
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  getGroupContactFacts,
  getGroupRelationshipGraphFacts,
  getNonSystemMembersForContacts,
  getPrivateContactFacts,
  resolveOwnerMember,
} from '../contact-queries'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
const SYSTEM_MESSAGE_TYPE = 80

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

describe('contact query helpers', () => {
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
        (2, 'alice-pid', 'Alice', 'Alice G', '["Ally","小爱"]', 'alice.png'),
        (3, 'bob-pid', 'Bob', NULL, '[]', NULL),
        (99, 'sys-pid', '系统消息', NULL, '[]', NULL);
    `)
    db = new Adapter(raw)
  })

  afterEach(() => {
    raw.close()
  })

  it('resolves meta.owner_id to the matching member id', () => {
    assert.deepEqual(resolveOwnerMember(db), {
      id: 1,
      platformId: 'owner-pid',
      name: 'Owner',
      aliases: [],
      avatar: null,
    })
  })

  it('returns saved member aliases for contact candidates', () => {
    const alice = getNonSystemMembersForContacts(db).find((member) => member.platformId === 'alice-pid')

    assert.ok(alice)
    assert.deepEqual(alice.aliases, ['Ally', '小爱'])
  })

  it('returns null when owner_id is missing or cannot be matched', () => {
    raw.exec('UPDATE meta SET owner_id = NULL')
    assert.equal(resolveOwnerMember(db), null)

    raw.exec("UPDATE meta SET owner_id = 'missing-pid'")
    assert.equal(resolveOwnerMember(db), null)
  })

  it('filters out system-message members from contact candidates', () => {
    const members = getNonSystemMembersForContacts(db)

    assert.deepEqual(
      members.map((m) => m.platformId),
      ['owner-pid', 'alice-pid', 'bob-pid']
    )
    assert.equal(
      members.find((m) => m.platformId === 'sys-pid'),
      undefined
    )
  })

  it('filters localized parser system members by stable sender identity', () => {
    raw.exec(`
      INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar)
      VALUES (100, 'system', '系統', NULL, '[]', NULL);
    `)

    const members = getNonSystemMembersForContacts(db)

    assert.equal(
      members.find((m) => m.platformId === 'system'),
      undefined
    )
  })

  it('filters the group conversation itself from contact candidates and relationship facts', () => {
    raw.exec(`
      ALTER TABLE meta ADD COLUMN group_id TEXT;
      UPDATE meta SET name = 'Project Group', group_id = 'group-pid';
      INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar)
      VALUES
        (100, 'group-pid', 'Project Group', NULL, '[]', NULL),
        (101, 'Project Group', 'Project Group', NULL, '[]', NULL);
    `)
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 1, 1704103200, 0, 'owner', 'owner-1', null)
    insert.run(2, 2, 1704103260, 0, 'alice', 'alice-1', null)
    insert.run(3, 100, 1704103320, 0, 'group pseudo sender', 'group-1', null)
    insert.run(4, 101, 1704103380, 0, 'legacy group pseudo sender', 'group-legacy-1', null)

    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    assert.equal(
      getNonSystemMembersForContacts(db).some(
        (member) => member.platformId === 'group-pid' || member.platformId === 'Project Group'
      ),
      false
    )
    assert.equal(
      getGroupContactFacts(db, owner.id).some(
        (fact) => fact.contact.platformId === 'group-pid' || fact.contact.platformId === 'Project Group'
      ),
      false
    )
    assert.equal(
      getGroupRelationshipGraphFacts(db, owner.id).members.some(
        (member) => member.contact.platformId === 'group-pid' || member.contact.platformId === 'Project Group'
      ),
      false
    )
  })

  it('returns private contact facts when the counterpart is unique', () => {
    raw.exec("UPDATE meta SET type = 'private'")
    raw.exec('DELETE FROM member WHERE id = 3')
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 1, 1704103200, 0, 'from owner', 'm1')
    insert.run(2, 2, 1704103260, 0, 'from alice', 'm2')
    insert.run(3, 99, 1704103320, 0, 'system', 'm3')
    insert.run(4, 2, 1706781600, 0, 'next month', 'm4')

    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    assert.deepEqual(getPrivateContactFacts(db, owner.id), {
      type: 'ok',
      contact: {
        id: 2,
        platformId: 'alice-pid',
        name: 'Alice G',
        aliases: ['Ally', '小爱'],
        avatar: 'alice.png',
      },
      privateMessageCount: 3,
      activeMonths: ['2024-01', '2024-02'],
      lastMessageTs: 1706781600,
    })
  })

  it('does not mark private LINE sessions ambiguous when they include localized system events', () => {
    raw.exec("UPDATE meta SET type = 'private'")
    raw.exec(`
      DELETE FROM member WHERE id = 3;
      INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar)
      VALUES (100, 'system', '系統', NULL, '[]', NULL);
    `)
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 1, 1704103200, 0, 'from owner', 'm1')
    insert.run(2, 2, 1704103260, 0, 'from alice', 'm2')
    insert.run(3, 100, 1704103320, SYSTEM_MESSAGE_TYPE, 'localized system event', 'system-1')

    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    const facts = getPrivateContactFacts(db, owner.id)

    assert.equal(facts.type, 'ok')
    assert.equal(facts.type === 'ok' ? facts.contact.platformId : null, 'alice-pid')
    assert.equal(facts.type === 'ok' ? facts.privateMessageCount : null, 2)
  })

  it('filters private contact facts by message start timestamp', () => {
    raw.exec("UPDATE meta SET type = 'private'")
    raw.exec('DELETE FROM member WHERE id = 3')
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 1, 1600000000, 0, 'old owner', 'old-1')
    insert.run(2, 2, 1600000100, 0, 'old alice', 'old-2')
    insert.run(3, 2, 1704103200, 0, 'new alice', 'new-1')

    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    const result = getPrivateContactFacts(db, owner.id, { startTs: 1700000000 })

    assert.equal(result.type, 'ok')
    assert.equal(result.type === 'ok' ? result.privateMessageCount : 0, 1)
    assert.deepEqual(result.type === 'ok' ? result.activeMonths : [], ['2024-01'])
    assert.equal(result.type === 'ok' ? result.lastMessageTs : null, 1704103200)
  })

  it('does not mark private sessions ambiguous when extra members are inactive in the selected range', () => {
    raw.exec("UPDATE meta SET type = 'private'")
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 3, 1600000000, 0, 'old bob residue', 'old-bob')
    insert.run(2, 1, 1704103200, 0, 'from owner', 'owner-1')
    insert.run(3, 2, 1704103260, 0, 'from alice', 'alice-1')

    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    const result = getPrivateContactFacts(db, owner.id, { startTs: 1700000000 })

    assert.equal(result.type, 'ok')
    assert.equal(result.type === 'ok' ? result.contact.platformId : null, 'alice-pid')
    assert.equal(result.type === 'ok' ? result.privateMessageCount : null, 2)
  })

  it('marks private sessions with multiple non-owner members as ambiguous', () => {
    raw.exec("UPDATE meta SET type = 'private'")
    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    const result = getPrivateContactFacts(db, owner.id)

    assert.equal(result.type, 'ambiguous')
    assert.deepEqual(result.type === 'ambiguous' ? result.candidates.map((m) => m.platformId) : [], [
      'alice-pid',
      'bob-pid',
    ])
  })

  it('marks private sessions with no valid counterpart as missing', () => {
    raw.exec("UPDATE meta SET type = 'private'; DELETE FROM member WHERE id IN (2, 3)")
    const owner = resolveOwnerMember(db)
    assert.ok(owner)

    assert.deepEqual(getPrivateContactFacts(db, owner.id), { type: 'missing' })
  })

  it('returns one group contact fact per non-owner non-system member', () => {
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 1, 1704103200, 0, 'owner', 'owner-1')
    insert.run(2, 2, 1704103260, 0, 'alice', 'alice-1')
    insert.run(3, 2, 1704103320, 0, 'alice again', 'alice-2')
    insert.run(4, 99, 1704103380, 0, 'system', 'sys-1')

    const facts = getGroupContactFacts(db, owner.id)

    assert.deepEqual(
      facts.map((fact) => [fact.contact.platformId, fact.messageCount]),
      [
        ['alice-pid', 2],
        ['bob-pid', 0],
      ]
    )
  })

  it('filters members that only emit system message types even when their localized name is unknown', () => {
    raw.exec(`
      INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar)
      VALUES (100, 'line-event', 'LINE event', NULL, '[]', NULL);
    `)
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 1, 1704103200, 0, 'owner', 'owner-1')
    insert.run(2, 2, 1704103260, 0, 'alice', 'alice-1')
    insert.run(3, 100, 1704103320, SYSTEM_MESSAGE_TYPE, 'unknown localized system event', 'sys-1')

    const facts = getGroupContactFacts(db, owner.id)

    assert.equal(
      facts.find((fact) => fact.contact.platformId === 'line-event'),
      undefined
    )
  })

  it('counts structured reply interactions in both directions', () => {
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 1, 1704103200, 0, 'owner to group', 'owner-1', null)
    insert.run(2, 2, 1704103260, 0, 'alice replies owner', 'alice-1', 'owner-1')
    insert.run(3, 3, 1704103320, 0, 'bob to group', 'bob-1', null)
    insert.run(4, 1, 1704103380, 0, 'owner replies bob', 'owner-2', 'bob-1')

    const facts = getGroupContactFacts(db, owner.id)
    const alice = facts.find((fact) => fact.contact.platformId === 'alice-pid')
    const bob = facts.find((fact) => fact.contact.platformId === 'bob-pid')

    assert.ok(alice)
    assert.equal(alice.repliesFromContactToOwner, 1)
    assert.equal(alice.repliesFromOwnerToContact, 0)
    assert.equal(alice.replyInteractionCount, 1)
    assert.equal(alice.lastInteractionTs, 1704103260)

    assert.ok(bob)
    assert.equal(bob.repliesFromContactToOwner, 0)
    assert.equal(bob.repliesFromOwnerToContact, 1)
    assert.equal(bob.replyInteractionCount, 1)
    assert.equal(bob.lastInteractionTs, 1704103380)
  })

  it('filters group contact facts and reply edges by message start timestamp', () => {
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      `INSERT INTO message
        (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run(1, 1, 1600000000, 0, 'old owner', 'old-owner', null)
    insert.run(2, 2, 1600000001, 0, 'old alice', 'old-alice', 'old-owner')
    insert.run(3, 1, 1704103200, 0, 'new owner', 'new-owner', null)
    insert.run(4, 2, 1704103201, 0, 'new alice', 'new-alice', 'new-owner')
    insert.run(5, 1, 1704103202, 0, 'owner replies old alice', 'new-owner-reply-old', 'old-alice')

    const facts = getGroupContactFacts(db, owner.id, { startTs: 1700000000 })
    const alice = facts.find((fact) => fact.contact.platformId === 'alice-pid')

    assert.ok(alice)
    assert.equal(alice.messageCount, 1)
    assert.equal(alice.replyInteractionCount, 1)
    assert.equal(alice.repliesFromContactToOwner, 1)
    assert.equal(alice.repliesFromOwnerToContact, 0)
    assert.equal(alice.lastInteractionTs, 1704103201)
  })

  it('computes owner-contact co-occurrence from nearby group messages', () => {
    const owner = resolveOwnerMember(db)
    assert.ok(owner)
    const insert = raw.prepare(
      'INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 1, 1704103200, 0, 'owner starts', 'owner-1')
    insert.run(2, 2, 1704103201, 0, 'alice follows', 'alice-1')
    insert.run(3, 1, 1704103202, 0, 'owner again', 'owner-2')
    insert.run(4, 2, 1704103203, 0, 'alice follows again', 'alice-2')
    insert.run(5, 3, 1704103800, 0, 'bob much later', 'bob-1')

    const facts = getGroupContactFacts(db, owner.id)
    const alice = facts.find((fact) => fact.contact.platformId === 'alice-pid')
    const bob = facts.find((fact) => fact.contact.platformId === 'bob-pid')

    assert.ok(alice)
    assert.ok(bob)
    assert.ok(alice.coOccurrenceCount > bob.coOccurrenceCount)
    assert.ok(alice.coOccurrenceRawScore > bob.coOccurrenceRawScore)
    assert.equal(alice.lastInteractionTs, 1704103203)
  })
})
