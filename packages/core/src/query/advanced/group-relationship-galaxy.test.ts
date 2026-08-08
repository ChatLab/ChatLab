import assert from 'node:assert/strict'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getGroupRelationshipGalaxy } from './group-relationship-galaxy'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

class Statement implements PreparedStatement {
  readonly?: boolean

  constructor(private readonly statement: Database.Statement) {
    this.readonly = statement.readonly
  }

  get(...params: unknown[]) {
    return this.statement.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]) {
    return this.statement.all(...params) as Record<string, unknown>[]
  }

  run(...params: unknown[]): RunResult {
    const result = this.statement.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

class Adapter implements DatabaseAdapter {
  constructor(private readonly database: Database.Database) {}

  exec(sql: string) {
    this.database.exec(sql)
  }

  prepare(sql: string) {
    return new Statement(this.database.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn)()
  }

  pragma(pragma: string) {
    return this.database.pragma(pragma)
  }

  close() {
    this.database.close()
  }
}

describe('group relationship galaxy', () => {
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
      CREATE TABLE member_name_history (member_id INTEGER, name TEXT);
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
        (2, 'alice-pid', 'Alice', NULL, '["Ally"]', 'alice.png'),
        (3, 'bob-pid', 'Bob', NULL, '[]', NULL),
        (4, 'carol-pid', 'Carol', NULL, '[]', NULL),
        (99, 'system', '系统消息', NULL, '[]', NULL);
      INSERT INTO member_name_history (member_id, name) VALUES (3, 'Bobby');
    `)
    db = new Adapter(raw)
  })

  afterEach(() => raw.close())

  it('combines replies, mentions and proximity into an explainable undirected edge', () => {
    insertMessage(1, 1, 100, 'owner starts @Bobby @Bobby', 'm1')
    insertMessage(2, 3, 101, 'bob replies', 'm2', 'm1')
    insertMessage(3, 2, 102, 'alice joins', 'm3')

    const result = getGroupRelationshipGalaxy(db)
    const ownerBob = result.edges.find((edge) => edge.id === 'member:1--member:3')

    assert.ok(ownerBob)
    assert.equal(ownerBob.replyInteractionCount, 1)
    assert.equal(ownerBob.mentionInteractionCount, 1)
    assert.ok(ownerBob.coOccurrenceCount > 0)
    assert.equal(
      ownerBob.weight,
      Number((ownerBob.coOccurrenceRawScore + 3 + 2 + ownerBob.coOccurrenceCount * 0.05).toFixed(4))
    )
    assert.equal(
      result.members.some((member) => member.platformId === 'owner-pid'),
      true
    )
    assert.equal(result.stats.displayedMembers, 3)
  })

  it('applies the same time range to messages, mentions and both sides of replies', () => {
    insertMessage(1, 1, 50, '@Bob', 'old-owner')
    insertMessage(2, 3, 60, 'old reply', 'old-bob', 'old-owner')
    insertMessage(3, 1, 100, '@Alice', 'new-owner')
    insertMessage(4, 2, 101, 'new reply', 'new-alice', 'new-owner')
    insertMessage(5, 99, 102, '@Alice', 'system', null, 80)

    const result = getGroupRelationshipGalaxy(db, { startTs: 100, endTs: 101 })

    assert.equal(result.stats.activeMembers, 2)
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].id, 'member:1--member:2')
    assert.equal(result.edges[0].replyInteractionCount, 1)
    assert.equal(result.edges[0].mentionInteractionCount, 1)
  })

  it('does not guess an ambiguous mention target when display names collide', () => {
    raw
      .prepare('INSERT INTO member (id, platform_id, account_name, aliases) VALUES (?, ?, ?, ?)')
      .run(5, 'bob-two', 'Bob', '[]')
    insertMessage(1, 1, 100, '@Bob', 'm1')
    insertMessage(2, 3, 101, 'first bob', 'm2')
    insertMessage(3, 5, 102, 'second bob', 'm3')

    const result = getGroupRelationshipGalaxy(db)

    assert.equal(
      result.edges.reduce((sum, edge) => sum + edge.mentionInteractionCount, 0),
      0
    )
    assert.deepEqual(
      result.members
        .filter((member) => member.displayName.startsWith('Bob#'))
        .map((member) => member.displayName)
        .sort(),
      ['Bob#-pid', 'Bob#-two']
    )
  })

  it('keeps strong clusters separate across a weak temporal bridge and stays deterministic', () => {
    insertMessage(1, 1, 100, '@Alice', 'a1')
    insertMessage(2, 2, 101, 'reply owner', 'a2', 'a1')
    insertMessage(3, 1, 102, 'owner again', 'a3')
    insertMessage(4, 3, 10_000, '@Carol', 'b1')
    insertMessage(5, 4, 10_001, 'reply bob', 'b2', 'b1')
    insertMessage(6, 3, 10_002, 'bob again', 'b3')

    const first = getGroupRelationshipGalaxy(db)
    const second = getGroupRelationshipGalaxy(db)

    assert.equal(first.stats.communityCount, 2)
    assert.deepEqual(first, second)
  })

  it('returns an explicit empty graph when the range has fewer than two active members', () => {
    insertMessage(1, 1, 100, 'only owner', 'm1')

    const result = getGroupRelationshipGalaxy(db)

    assert.equal(result.stats.totalMembers, 4)
    assert.equal(result.stats.activeMembers, 1)
    assert.deepEqual(result.graph, { nodes: [], edges: [], communities: [] })
    assert.deepEqual(result.members, [])
  })

  function insertMessage(
    id: number,
    senderId: number,
    ts: number,
    content: string,
    platformMessageId: string,
    replyToMessageId: string | null = null,
    type = 0
  ) {
    raw
      .prepare(
        `INSERT INTO message
          (id, sender_id, ts, type, content, platform_message_id, reply_to_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, senderId, ts, type, content, platformMessageId, replyToMessageId)
  }
})
