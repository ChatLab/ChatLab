import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getJourneyStats } from './journey'

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

function timestamp(year: number, month: number, day: number, hour = 12, minute = 0): number {
  // Midday UTC keeps the fixture inside the same natural date in all practical time zones.
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000)
}

describe('private chat journey analysis', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = new Database(':memory:')
    raw.exec(`
      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT NOT NULL,
        account_name TEXT,
        group_nickname TEXT
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
      INSERT INTO member (id, platform_id, account_name) VALUES
        (1, 'alice', 'Alice'),
        (2, 'bob', 'Bob'),
        (99, 'system', '系统消息');
    `)
    db = new Adapter(raw)
  })

  afterEach(() => raw.close())

  it('returns an empty result when no effective messages exist', () => {
    assert.deepEqual(getJourneyStats(db), {
      range: null,
      hasSessionIndex: false,
      months: [],
      years: [],
      peakMonth: null,
      longestSegment: null,
      longestSilence: null,
    })
  })

  it('keeps message-level history available without a segment index', () => {
    insertMessage(raw, 1, 1, timestamp(2024, 1, 15), 'hello')
    insertMessage(raw, 2, 2, timestamp(2024, 3, 15), 'world')

    const result = getJourneyStats(db)

    assert.equal(result.hasSessionIndex, false)
    assert.equal(result.range?.activeDays, 2)
    assert.equal(result.range?.activeMonths, 2)
    assert.equal(result.range?.spanMonths, 3)
    assert.deepEqual(
      result.months.map(({ month, messageCount, activeDays, segmentCount }) => ({
        month,
        messageCount,
        activeDays,
        segmentCount,
      })),
      [
        { month: '2024-01', messageCount: 1, activeDays: 1, segmentCount: null },
        { month: '2024-02', messageCount: 0, activeDays: 0, segmentCount: null },
        { month: '2024-03', messageCount: 1, activeDays: 1, segmentCount: null },
      ]
    )
    assert.equal(result.longestSegment, null)
    assert.equal(result.longestSilence, null)
  })

  it('aggregates years, excludes system messages, and resolves peak ties toward the earlier month', () => {
    insertMessage(raw, 1, 1, timestamp(2023, 1, 15, 10), 'one')
    insertMessage(raw, 2, 2, timestamp(2023, 1, 15, 11), 'two')
    insertMessage(raw, 3, 2, timestamp(2023, 3, 20, 10), 'three')
    insertMessage(raw, 4, 1, timestamp(2023, 3, 20, 11), 'four')
    insertMessage(raw, 5, 2, timestamp(2023, 3, 20, 12), 'five')
    insertMessage(raw, 6, 1, timestamp(2024, 2, 10, 10), 'six')
    insertMessage(raw, 7, 2, timestamp(2024, 2, 10, 11), 'seven')
    insertMessage(raw, 8, 1, timestamp(2024, 2, 11, 10), 'eight')
    insertMessage(raw, 99, 99, timestamp(2025, 6, 1), 'ignored system message')

    const result = getJourneyStats(db)

    assert.equal(result.range?.firstMessageTs, timestamp(2023, 1, 15, 10))
    assert.equal(result.range?.lastMessageTs, timestamp(2024, 2, 11, 10))
    assert.equal(result.range?.activeDays, 4)
    assert.equal(result.range?.activeMonths, 3)
    assert.equal(result.range?.spanMonths, 14)
    assert.equal(result.months.length, 14)
    assert.deepEqual(result.peakMonth, {
      month: '2023-03',
      messageCount: 3,
      activeDays: 1,
      segmentCount: null,
    })
    assert.deepEqual(result.years, [
      {
        year: 2023,
        messageCount: 5,
        activeDays: 2,
        activeMonths: 2,
        peakMonth: '2023-03',
        peakMonthMessageCount: 3,
      },
      {
        year: 2024,
        messageCount: 3,
        activeDays: 2,
        activeMonths: 1,
        peakMonth: '2024-02',
        peakMonthMessageCount: 3,
      },
    ])
  })

  it('finds the longest effective segment and silence with a stable reopening member', () => {
    const janStart = timestamp(2023, 1, 15, 10)
    const marchStart = timestamp(2023, 3, 20, 10)
    const febStart = timestamp(2024, 2, 10, 10)

    insertSegment(raw, 1, janStart, janStart + 600, 2)
    insertSegment(raw, 2, marchStart, marchStart + 7200, 3)
    insertSegment(raw, 3, febStart, febStart + 1800, 3)

    insertMessage(raw, 1, 1, janStart, 'one', 1)
    insertMessage(raw, 2, 2, janStart + 600, 'two', 1)
    insertMessage(raw, 3, 2, marchStart, 'three', 2)
    insertMessage(raw, 4, 1, marchStart + 3600, 'four', 2)
    insertMessage(raw, 5, 2, marchStart + 7200, 'five', 2)
    insertMessage(raw, 6, 1, febStart, 'six', 3)
    insertMessage(raw, 7, 2, febStart + 1800, 'seven', 3)
    insertMessage(raw, 99, 99, febStart + 7200, 'ignored system message', 3)

    const result = getJourneyStats(db)

    assert.equal(result.hasSessionIndex, true)
    assert.deepEqual(result.longestSegment, {
      segmentId: 2,
      startTs: marchStart,
      endTs: marchStart + 7200,
      durationSeconds: 7200,
      messageCount: 3,
      initiator: { memberId: 2, name: 'Bob' },
    })
    assert.deepEqual(result.longestSilence, {
      previousSegmentId: 2,
      nextSegmentId: 3,
      startTs: marchStart + 7200,
      endTs: febStart,
      durationSeconds: febStart - (marchStart + 7200),
      reopenedBy: { memberId: 1, name: 'Alice' },
    })
    assert.equal(result.months.find((month) => month.month === '2023-01')?.segmentCount, 1)
    assert.equal(result.months.find((month) => month.month === '2023-02')?.segmentCount, 0)
  })

  it('clips segment metrics to the selected time range', () => {
    const firstStart = timestamp(2024, 4, 10, 10)
    const secondStart = timestamp(2024, 4, 12, 10)
    insertSegment(raw, 1, firstStart, firstStart + 7200, 3)
    insertSegment(raw, 2, secondStart, secondStart + 3600, 2)

    insertMessage(raw, 1, 1, firstStart, 'outside start', 1)
    insertMessage(raw, 2, 2, firstStart + 3600, 'inside one', 1)
    insertMessage(raw, 3, 1, firstStart + 7200, 'inside two', 1)
    insertMessage(raw, 4, 2, secondStart, 'inside three', 2)
    insertMessage(raw, 5, 1, secondStart + 3600, 'outside end', 2)

    const result = getJourneyStats(db, {
      startTs: firstStart + 1800,
      endTs: secondStart + 1800,
    })

    assert.equal(result.range?.firstMessageTs, firstStart + 3600)
    assert.equal(result.range?.lastMessageTs, secondStart)
    assert.deepEqual(result.longestSegment, {
      segmentId: 1,
      startTs: firstStart + 3600,
      endTs: firstStart + 7200,
      durationSeconds: 3600,
      messageCount: 2,
      initiator: { memberId: 2, name: 'Bob' },
    })
    assert.deepEqual(result.longestSilence, {
      previousSegmentId: 1,
      nextSegmentId: 2,
      startTs: firstStart + 7200,
      endTs: secondStart,
      durationSeconds: secondStart - (firstStart + 7200),
      reopenedBy: { memberId: 2, name: 'Bob' },
    })
  })
})

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
  content: string,
  segmentId?: number
): void {
  database
    .prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, 0, ?)')
    .run(id, senderId, ts, content)
  if (segmentId !== undefined) {
    database
      .prepare('INSERT INTO message_context (message_id, segment_id, topic_id) VALUES (?, ?, NULL)')
      .run(id, segmentId)
  }
}
