/**
 * Tests for session index functions extracted to core:
 *   hasSessionIndex, getSessionIndexStats, getChatSessionList,
 *   getSegmentSummary, saveSegmentSummary, updateSessionGapThreshold,
 *   clearSessionIndex, generateSessionIndex, generateIncrementalSessionIndex.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/session-index.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  DEFAULT_SESSION_GAP_THRESHOLD,
  hasSessionIndex,
  getSessionIndexStats,
  getChatSessionList,
  getSegmentSummary,
  saveSegmentSummary,
  updateSessionGapThreshold,
  clearSessionIndex,
  generateSessionIndex,
  generateIncrementalSessionIndex,
} from '../session-queries'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'

// ==================== SQLite test DB ====================

class SqlitePreparedStatement implements PreparedStatement {
  readonly?: boolean

  constructor(private stmt: Database.Statement) {
    this.readonly = stmt.readonly
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...params) as Record<string, unknown>[]
  }

  run(...params: unknown[]): RunResult {
    const result = this.stmt.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

class TestSqliteDb implements DatabaseAdapter {
  constructor(private db: Database.Database) {}

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): PreparedStatement {
    return new SqlitePreparedStatement(this.db.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  pragma(pragma: string): unknown {
    return this.db.pragma(pragma)
  }

  close(): void {
    this.db.close()
  }
}

function createSqliteDb(): TestSqliteDb {
  const db = new TestSqliteDb(new Database(':memory:'))
  db.exec(`
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TABLE segment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );
    CREATE TABLE message_context (
      message_id INTEGER NOT NULL,
      segment_id INTEGER NOT NULL,
      topic_id INTEGER
    );
    CREATE TABLE meta (
      session_gap_threshold INTEGER
    );
    INSERT INTO meta (session_gap_threshold) VALUES (NULL);
  `)
  return db
}

function seedMessages(db: DatabaseAdapter, msgs: Array<{ id: number; ts: number }>) {
  const insert = db.prepare('INSERT INTO message (id, ts) VALUES (?, ?)')
  for (const msg of msgs) {
    insert.run(msg.id, msg.ts)
  }
}

function countRows(db: DatabaseAdapter, table: 'segment' | 'message_context'): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
  return row.count
}

function getMetaGapThreshold(db: DatabaseAdapter): number | null {
  const row = db.prepare('SELECT session_gap_threshold FROM meta LIMIT 1').get() as {
    session_gap_threshold: number | null
  }
  return row.session_gap_threshold
}

// ==================== Tests ====================

describe('DEFAULT_SESSION_GAP_THRESHOLD', () => {
  it('equals 1800 (30 minutes)', () => {
    assert.equal(DEFAULT_SESSION_GAP_THRESHOLD, 1800)
  })
})

describe('hasSessionIndex', () => {
  it('returns false when no sessions exist', () => {
    const db = createSqliteDb()
    assert.equal(hasSessionIndex(db), false)
  })

  it('returns true after generating sessions', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
    ])
    generateSessionIndex(db)
    assert.equal(hasSessionIndex(db), true)
  })
})

describe('getSessionIndexStats', () => {
  it('returns defaults when no index exists', () => {
    const db = createSqliteDb()
    const stats = getSessionIndexStats(db)
    assert.equal(stats.sessionCount, 0)
    assert.equal(stats.hasIndex, false)
    assert.equal(stats.gapThreshold, DEFAULT_SESSION_GAP_THRESHOLD)
  })

  it('returns custom gap threshold from meta', () => {
    const db = createSqliteDb()
    updateSessionGapThreshold(db, 900)
    const stats = getSessionIndexStats(db)
    assert.equal(stats.gapThreshold, 900)
  })
})

describe('generateSessionIndex', () => {
  it('returns 0 when no messages exist', () => {
    const db = createSqliteDb()
    assert.equal(generateSessionIndex(db), 0)
  })

  it('creates sessions based on gap threshold', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
      { id: 3, ts: 5000 },
      { id: 4, ts: 5100 },
    ])

    const count = generateSessionIndex(db, 2000)
    assert.equal(count, 2)
    assert.equal(countRows(db, 'segment'), 2)
    assert.equal(countRows(db, 'message_context'), 4)
  })

  it('puts all messages in one session when gap is large enough', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
      { id: 3, ts: 5000 },
    ])

    const count = generateSessionIndex(db, 99999)
    assert.equal(count, 1)
  })

  it('clears previous sessions before regenerating', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])

    generateSessionIndex(db, 2000)
    assert.equal(countRows(db, 'segment'), 2)

    generateSessionIndex(db, 99999)
    assert.equal(countRows(db, 'segment'), 1)
  })

  it('calls onProgress callback', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])

    let finalCurrent = 0
    let finalTotal = 0
    generateSessionIndex(db, 2000, (c, t) => {
      finalCurrent = c
      finalTotal = t
    })
    assert.equal(finalCurrent, 2)
    assert.equal(finalTotal, 2)
  })
})

describe('getChatSessionList', () => {
  it('returns empty array when no sessions', () => {
    const db = createSqliteDb()
    assert.deepEqual(getChatSessionList(db), [])
  })

  it('returns sessions with firstMessageId', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 10, ts: 1000 },
      { id: 20, ts: 1100 },
      { id: 30, ts: 5000 },
    ])
    generateSessionIndex(db, 2000)

    const list = getChatSessionList(db)
    assert.equal(list.length, 2)
    assert.equal(list[0].firstMessageId, 10)
    assert.equal(list[0].messageCount, 2)
    assert.equal(list[1].firstMessageId, 30)
  })
})

describe('getSegmentSummary / saveSegmentSummary', () => {
  it('returns null when no summary set', () => {
    const db = createSqliteDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db)

    assert.equal(getSegmentSummary(db, 1), null)
  })

  it('saves and retrieves summary', () => {
    const db = createSqliteDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db)

    saveSegmentSummary(db, 1, 'Test summary')
    assert.equal(getSegmentSummary(db, 1), 'Test summary')
  })
})

describe('updateSessionGapThreshold', () => {
  it('updates gap threshold in meta', () => {
    const db = createSqliteDb()
    updateSessionGapThreshold(db, 900)
    assert.equal(getMetaGapThreshold(db), 900)
  })

  it('accepts null to reset', () => {
    const db = createSqliteDb()
    updateSessionGapThreshold(db, 900)
    updateSessionGapThreshold(db, null)
    assert.equal(getMetaGapThreshold(db), null)
  })
})

describe('clearSessionIndex', () => {
  it('removes all sessions and contexts', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])
    generateSessionIndex(db, 2000)
    assert.ok(countRows(db, 'segment') > 0)

    clearSessionIndex(db)
    assert.equal(countRows(db, 'segment'), 0)
    assert.equal(countRows(db, 'message_context'), 0)
  })

  it('rolls back context deletion when segment deletion fails', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])
    generateSessionIndex(db, 2000)
    db.exec(`
      CREATE TRIGGER prevent_segment_delete
      BEFORE DELETE ON segment
      BEGIN
        SELECT RAISE(ABORT, 'blocked');
      END;
    `)

    assert.throws(() => clearSessionIndex(db), /blocked/)
    assert.equal(countRows(db, 'segment'), 2)
    assert.equal(countRows(db, 'message_context'), 2)
  })
})

describe('generateIncrementalSessionIndex', () => {
  it('returns 0 when no new messages', () => {
    const db = createSqliteDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db)

    const newCount = generateIncrementalSessionIndex(db)
    assert.equal(newCount, 0)
  })

  it('creates new sessions for unindexed messages', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
    ])
    generateSessionIndex(db, 2000)
    assert.equal(countRows(db, 'segment'), 1)

    seedMessages(db, [{ id: 3, ts: 50000 }])

    const newCount = generateIncrementalSessionIndex(db, 2000)
    assert.equal(newCount, 1)
    assert.equal(countRows(db, 'segment'), 2)
  })

  it('appends to existing session when within threshold', () => {
    const db = createSqliteDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db, 2000)

    seedMessages(db, [{ id: 2, ts: 1500 }])

    const newCount = generateIncrementalSessionIndex(db, 2000)
    assert.equal(newCount, 0, 'should not create new session')
    assert.equal(countRows(db, 'message_context'), 2)
  })
})

describe('generateSessionIndex atomicity', () => {
  it('preserves the existing index when rebuilding fails', () => {
    const db = createSqliteDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])
    generateSessionIndex(db, 2000)
    db.exec(`
      CREATE TRIGGER prevent_segment_insert
      BEFORE INSERT ON segment
      BEGIN
        SELECT RAISE(ABORT, 'blocked');
      END;
    `)

    assert.throws(() => generateSessionIndex(db, 2000), /blocked/)
    assert.equal(countRows(db, 'segment'), 2)
    assert.equal(countRows(db, 'message_context'), 2)
  })
})
