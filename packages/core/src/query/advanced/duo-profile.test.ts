import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getDuoProfileStats } from './duo-profile'

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

function localTimestamp(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000)
}

describe('private chat duo profile analysis', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = new Database(':memory:')
    raw.exec(`
      CREATE TABLE meta (
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        owner_id TEXT
      );
      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT NOT NULL,
        account_name TEXT,
        group_nickname TEXT,
        aliases TEXT DEFAULT '[]',
        avatar TEXT
      );
      CREATE TABLE message (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        type INTEGER NOT NULL,
        content TEXT
      );
      CREATE TABLE segment (
        id INTEGER PRIMARY KEY,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );
      CREATE TABLE message_context (
        message_id INTEGER PRIMARY KEY,
        segment_id INTEGER NOT NULL,
        topic_id INTEGER
      );
      INSERT INTO meta (name, platform, type, imported_at, owner_id)
      VALUES ('Alice & Bob', 'wechat', 'private', 0, 'alice');
      INSERT INTO member (id, platform_id, account_name) VALUES
        (1, 'alice', 'Alice'),
        (2, 'bob', 'Bob'),
        (99, 'system', '系统消息');
    `)
    db = new Adapter(raw)
  })

  afterEach(() => raw.close())

  it('returns explicit unavailable reasons instead of guessing participants', () => {
    raw.exec('UPDATE meta SET owner_id = NULL')
    assert.deepEqual(getDuoProfileStats(db), { status: 'unavailable', reason: 'owner_missing' })

    raw.exec("UPDATE meta SET owner_id = 'alice'; DELETE FROM member WHERE id = 2")
    assert.deepEqual(getDuoProfileStats(db), { status: 'unavailable', reason: 'counterpart_missing' })

    raw.exec(`
      INSERT INTO member (id, platform_id, account_name) VALUES
        (2, 'bob', 'Bob'),
        (3, 'carol', 'Carol');
    `)
    assert.deepEqual(getDuoProfileStats(db), {
      status: 'unavailable',
      reason: 'ambiguous',
      candidateCount: 2,
    })

    raw.exec("DELETE FROM member WHERE id = 3; UPDATE meta SET type = 'group'")
    assert.deepEqual(getDuoProfileStats(db), { status: 'unavailable', reason: 'not_private' })
  })

  it('aggregates member, expression, and schedule metrics without a session index', () => {
    const start = localTimestamp(2024, 1, 6, 0, 30)
    insertProfileMessages(raw)
    insertMessage(raw, 99, 99, localTimestamp(2024, 1, 9, 23), 0, 'ignored system message')

    const result = getDuoProfileStats(db)
    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') return

    assert.equal(result.hasSessionIndex, false)
    assert.deepEqual(result.range, {
      firstMessageTs: start,
      lastMessageTs: localTimestamp(2024, 1, 8, 21, 5),
    })

    const [owner, counterpart] = result.members
    assert.deepEqual(owner, {
      memberId: 1,
      platformId: 'alice',
      name: 'Alice',
      role: 'owner',
      messageCount: 4,
      messageShare: 50,
      activeDays: 2,
      initiatedSegments: null,
      closedSegments: null,
      avgResponseSeconds: null,
      responseCount: null,
      continuationRate: null,
      textMessageCount: 4,
      avgTextLength: 10.8,
      shortTextRate: 50,
      longTextRate: 25,
      nonTextRate: 0,
      topNonTextType: null,
      hourlyActivity: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
      peakHour: 0,
      nightRate: 50,
      weekendRate: 50,
    })
    assert.deepEqual(counterpart, {
      memberId: 2,
      platformId: 'bob',
      name: 'Bob',
      role: 'counterpart',
      messageCount: 4,
      messageShare: 50,
      activeDays: 2,
      initiatedSegments: null,
      closedSegments: null,
      avgResponseSeconds: null,
      responseCount: null,
      continuationRate: null,
      textMessageCount: 3,
      avgTextLength: 5,
      shortTextRate: 66.67,
      longTextRate: 0,
      nonTextRate: 25,
      topNonTextType: { type: 1, count: 1 },
      hourlyActivity: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0],
      peakHour: 20,
      nightRate: 25,
      weekendRate: 25,
    })
    assert.deepEqual(result.common, {
      activeDayIntersection: 2,
      activeDayUnion: 2,
      activeDayOverlapRate: 100,
      hourlyOverlapRate: 75,
      commonActiveHours: [0, 20, 21],
    })
  })

  it('adds clipped conversation metrics when a session index is available', () => {
    insertProfileMessages(raw, true)

    const result = getDuoProfileStats(db)
    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') return

    assert.equal(result.hasSessionIndex, true)
    const [owner, counterpart] = result.members
    assert.deepEqual(
      {
        initiatedSegments: owner.initiatedSegments,
        closedSegments: owner.closedSegments,
        avgResponseSeconds: owner.avgResponseSeconds,
        responseCount: owner.responseCount,
        continuationRate: owner.continuationRate,
      },
      {
        initiatedSegments: 1,
        closedSegments: 1,
        avgResponseSeconds: 300,
        responseCount: 1,
        continuationRate: 33.33,
      }
    )
    assert.deepEqual(
      {
        initiatedSegments: counterpart.initiatedSegments,
        closedSegments: counterpart.closedSegments,
        avgResponseSeconds: counterpart.avgResponseSeconds,
        responseCount: counterpart.responseCount,
        continuationRate: counterpart.continuationRate,
      },
      {
        initiatedSegments: 2,
        closedSegments: 2,
        avgResponseSeconds: 120,
        responseCount: 2,
        continuationRate: 0,
      }
    )
  })

  it('keeps identities stable and clips both messages and segments to the selected range', () => {
    const segmentStart = localTimestamp(2024, 2, 1, 10)
    insertSegment(raw, 1, segmentStart, segmentStart + 10800, 4)
    insertMessage(raw, 1, 1, segmentStart, 0, 'outside start', 1)
    insertMessage(raw, 2, 2, segmentStart + 3600, 0, 'inside bob', 1)
    insertMessage(raw, 3, 1, segmentStart + 7200, 0, 'inside alice', 1)
    insertMessage(raw, 4, 2, segmentStart + 10800, 0, 'outside end', 1)

    const clipped = getDuoProfileStats(db, {
      startTs: segmentStart + 1800,
      endTs: segmentStart + 9000,
    })
    assert.equal(clipped.status, 'ready')
    if (clipped.status !== 'ready') return

    assert.deepEqual(clipped.range, {
      firstMessageTs: segmentStart + 3600,
      lastMessageTs: segmentStart + 7200,
    })
    assert.equal(clipped.members[0].memberId, 1)
    assert.equal(clipped.members[1].memberId, 2)
    assert.equal(clipped.members[0].initiatedSegments, 0)
    assert.equal(clipped.members[0].closedSegments, 1)
    assert.equal(clipped.members[0].avgResponseSeconds, 3600)
    assert.equal(clipped.members[0].responseCount, 1)
    assert.equal(clipped.members[1].initiatedSegments, 1)
    assert.equal(clipped.members[1].closedSegments, 0)

    const ownerOnly = getDuoProfileStats(db, {
      startTs: segmentStart + 7000,
      endTs: segmentStart + 8000,
    })
    assert.equal(ownerOnly.status, 'ready')
    if (ownerOnly.status === 'ready') {
      assert.equal(ownerOnly.members[0].messageCount, 1)
      assert.equal(ownerOnly.members[1].messageCount, 0)
      assert.equal(ownerOnly.members[1].peakHour, null)
    }

    assert.deepEqual(getDuoProfileStats(db, { endTs: segmentStart - 1 }), {
      status: 'unavailable',
      reason: 'empty_range',
    })
  })

  it('excludes empty text messages from reply-time samples', () => {
    const start = localTimestamp(2024, 3, 1, 10)
    insertSegment(raw, 1, start, start + 300, 4)
    insertMessage(raw, 1, 1, start, 0, 'hello', 1)
    insertMessage(raw, 2, 2, start + 60, 0, null, 1)
    insertMessage(raw, 3, 1, start + 120, 0, 'still here', 1)
    insertMessage(raw, 4, 2, start + 300, 0, 'reply', 1)

    const result = getDuoProfileStats(db)
    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') return

    assert.equal(result.members[0].responseCount, 0)
    assert.equal(result.members[0].avgResponseSeconds, null)
    assert.equal(result.members[1].responseCount, 1)
    assert.equal(result.members[1].avgResponseSeconds, 180)
  })
})

function insertProfileMessages(database: Database.Database, withSegments = false): void {
  if (withSegments) {
    insertSegment(database, 1, localTimestamp(2024, 1, 6, 0, 30), localTimestamp(2024, 1, 6, 0, 33), 3)
    insertSegment(database, 2, localTimestamp(2024, 1, 8, 20), localTimestamp(2024, 1, 8, 20, 3), 3)
    insertSegment(database, 3, localTimestamp(2024, 1, 8, 21), localTimestamp(2024, 1, 8, 21, 5), 2)
  }

  insertMessage(database, 1, 1, localTimestamp(2024, 1, 6, 0, 30), 0, 'hi', withSegments ? 1 : undefined)
  insertMessage(database, 2, 1, localTimestamp(2024, 1, 6, 0, 31), 0, '123456', withSegments ? 1 : undefined)
  insertMessage(database, 3, 2, localTimestamp(2024, 1, 6, 0, 33), 0, '1234567890', withSegments ? 1 : undefined)
  insertMessage(database, 4, 2, localTimestamp(2024, 1, 8, 20), 1, null, withSegments ? 2 : undefined)
  insertMessage(
    database,
    5,
    1,
    localTimestamp(2024, 1, 8, 20, 1),
    0,
    '123456789012345678901234567890',
    withSegments ? 2 : undefined
  )
  insertMessage(database, 6, 2, localTimestamp(2024, 1, 8, 20, 3), 0, 'yo', withSegments ? 2 : undefined)
  insertMessage(database, 7, 2, localTimestamp(2024, 1, 8, 21), 0, 'hey', withSegments ? 3 : undefined)
  insertMessage(database, 8, 1, localTimestamp(2024, 1, 8, 21, 5), 0, '12345', withSegments ? 3 : undefined)
}

function insertSegment(
  database: Database.Database,
  id: number,
  startTs: number,
  endTs: number,
  messageCount: number
): void {
  database
    .prepare('INSERT INTO segment (id, start_ts, end_ts, message_count) VALUES (?, ?, ?, ?)')
    .run(id, startTs, endTs, messageCount)
}

function insertMessage(
  database: Database.Database,
  id: number,
  senderId: number,
  ts: number,
  type: number,
  content: string | null,
  segmentId?: number
): void {
  database
    .prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    .run(id, senderId, ts, type, content)
  if (segmentId !== undefined) {
    database
      .prepare('INSERT INTO message_context (message_id, segment_id, topic_id) VALUES (?, ?, NULL)')
      .run(id, segmentId)
  }
}
