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

// ==================== In-memory mock DB ====================

interface MockRow {
  [key: string]: unknown
}

/**
 * Lightweight in-memory DB for testing session index write operations.
 * Stores tables as arrays of rows and supports basic SQL pattern matching.
 */
function createInMemoryDb(): DatabaseAdapter & { tables: Record<string, MockRow[]> } {
  const tables: Record<string, MockRow[]> = {
    message: [],
    segment: [],
    message_context: [],
    meta: [{ session_gap_threshold: null }],
    sqlite_master: [],
  }
  let autoIncrement = 0

  const db: DatabaseAdapter & { tables: Record<string, MockRow[]> } = {
    tables,
    prepare(sql: string): PreparedStatement {
      return {
        get(...params: unknown[]) {
          return handleGet(sql, params)
        },
        all(...params: unknown[]) {
          return handleAll(sql, params)
        },
        run(...params: unknown[]): RunResult {
          return handleRun(sql, params)
        },
      }
    },
    exec(sql: string) {
      if (sql.includes('DELETE FROM message_context')) {
        tables.message_context = []
      }
      if (sql.includes('DELETE FROM segment')) {
        tables.segment = []
        autoIncrement = 0
      }
    },
    transaction<T>(fn: () => T): T {
      return fn()
    },
    pragma() {
      return undefined
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {},
  }

  function handleGet(sql: string, params: unknown[]): MockRow | undefined {
    if (sql.includes('sqlite_master')) {
      const tableName = (params[0] as string) ?? ''
      return tables[tableName] ? { cnt: 1 } : { cnt: 0 }
    }
    if (sql.includes('COUNT(*)') && sql.includes('FROM segment')) {
      return { count: tables.segment.length }
    }
    if (sql.includes('COUNT(*)') && sql.includes('FROM message')) {
      return { count: tables.message.length }
    }
    if (sql.includes('session_gap_threshold') && sql.includes('meta')) {
      return tables.meta[0] ?? { session_gap_threshold: null }
    }
    if (sql.includes('summary') && sql.includes('segment') && sql.includes('WHERE id')) {
      const id = params[0] as number
      const row = tables.segment.find((r) => r.id === id)
      return row ? { summary: row.summary ?? null } : undefined
    }
    if (sql.includes('end_ts') && sql.includes('segment') && sql.includes('ORDER BY end_ts DESC')) {
      const sorted = [...tables.segment].sort((a, b) => (b.end_ts as number) - (a.end_ts as number))
      return sorted[0] ? { id: sorted[0].id, end_ts: sorted[0].end_ts } : undefined
    }
    return undefined
  }

  function handleAll(sql: string, params: unknown[]): MockRow[] {
    if (sql.includes('sqlite_master')) {
      const tableName = (params[0] as string) ?? ''
      return tables[tableName] ? [{ cnt: 1 }] : [{ cnt: 0 }]
    }
    if (sql.includes('PRAGMA table_info')) {
      return [{ name: 'id' }]
    }
    if (sql.includes('session_num')) {
      const gt = params[0] as number
      const msgs = [...tables.message].sort(
        (a, b) => (a.ts as number) - (b.ts as number) || (a.id as number) - (b.id as number)
      )
      let sessionNum = 0
      let prevTs: number | null = null
      return msgs.map((m) => {
        if (prevTs === null || (m.ts as number) - prevTs > gt) {
          sessionNum++
        }
        prevTs = m.ts as number
        return { id: m.id, ts: m.ts, session_num: sessionNum }
      })
    }
    // segment list query (contains subquery on message_context) — must match before message_context
    if (sql.includes('FROM segment') && sql.includes('ORDER BY')) {
      return [...tables.segment]
        .sort((a, b) => (a.start_ts as number) - (b.start_ts as number))
        .map((s) => ({
          id: s.id,
          startTs: s.start_ts,
          endTs: s.end_ts,
          messageCount: s.message_count,
          summary: s.summary ?? null,
          firstMessageId:
            tables.message_context
              .filter((mc) => mc.segment_id === s.id)
              .sort((a, b) => (a.message_id as number) - (b.message_id as number))[0]?.message_id ?? 0,
        }))
    }
    if (sql.includes('message_context') && sql.includes('SELECT message_id')) {
      return tables.message_context.map((r) => ({ message_id: r.message_id }))
    }
    if (sql.includes('FROM message') && sql.includes('ORDER BY ts')) {
      return [...tables.message].sort(
        (a, b) => (a.ts as number) - (b.ts as number) || (a.id as number) - (b.id as number)
      )
    }
    return []
  }

  function handleRun(sql: string, params: unknown[]): RunResult {
    if (sql.includes('INSERT INTO segment')) {
      autoIncrement++
      tables.segment.push({
        id: autoIncrement,
        start_ts: params[0],
        end_ts: params[1],
        message_count: params[2],
        is_manual: 0,
        summary: null,
      })
      return { changes: 1, lastInsertRowid: autoIncrement }
    }
    if (sql.includes('INSERT') && sql.includes('message_context')) {
      tables.message_context.push({ message_id: params[0], segment_id: params[1], topic_id: null })
      return { changes: 1, lastInsertRowid: 0 }
    }
    if (sql.includes('UPDATE segment') && sql.includes('summary')) {
      const row = tables.segment.find((r) => r.id === params[1])
      if (row) row.summary = params[0]
      return { changes: row ? 1 : 0, lastInsertRowid: 0 }
    }
    if (sql.includes('UPDATE segment') && sql.includes('end_ts')) {
      const row = tables.segment.find((r) => r.id === params[2])
      if (row) {
        row.end_ts = params[0]
        row.message_count = (row.message_count as number) + (params[1] as number)
      }
      return { changes: row ? 1 : 0, lastInsertRowid: 0 }
    }
    if (sql.includes('UPDATE meta') && sql.includes('session_gap_threshold')) {
      if (tables.meta[0]) tables.meta[0].session_gap_threshold = params[0]
      return { changes: 1, lastInsertRowid: 0 }
    }
    if (sql.includes('DELETE FROM segment')) {
      tables.segment = []
      autoIncrement = 0
      return { changes: 0, lastInsertRowid: 0 }
    }
    if (sql.includes('DELETE FROM message_context')) {
      tables.message_context = []
      return { changes: 0, lastInsertRowid: 0 }
    }
    return { changes: 0, lastInsertRowid: 0 }
  }

  return db
}

function seedMessages(db: ReturnType<typeof createInMemoryDb>, msgs: Array<{ id: number; ts: number }>) {
  db.tables.message = msgs.map((m) => ({ id: m.id, ts: m.ts }))
}

// ==================== Tests ====================

describe('DEFAULT_SESSION_GAP_THRESHOLD', () => {
  it('equals 1800 (30 minutes)', () => {
    assert.equal(DEFAULT_SESSION_GAP_THRESHOLD, 1800)
  })
})

describe('hasSessionIndex', () => {
  it('returns false when no sessions exist', () => {
    const db = createInMemoryDb()
    assert.equal(hasSessionIndex(db), false)
  })

  it('returns true after generating sessions', () => {
    const db = createInMemoryDb()
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
    const db = createInMemoryDb()
    const stats = getSessionIndexStats(db)
    assert.equal(stats.sessionCount, 0)
    assert.equal(stats.hasIndex, false)
    assert.equal(stats.gapThreshold, DEFAULT_SESSION_GAP_THRESHOLD)
  })

  it('returns custom gap threshold from meta', () => {
    const db = createInMemoryDb()
    db.tables.meta[0].session_gap_threshold = 900
    const stats = getSessionIndexStats(db)
    assert.equal(stats.gapThreshold, 900)
  })
})

describe('generateSessionIndex', () => {
  it('returns 0 when no messages exist', () => {
    const db = createInMemoryDb()
    assert.equal(generateSessionIndex(db), 0)
  })

  it('creates sessions based on gap threshold', () => {
    const db = createInMemoryDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
      { id: 3, ts: 5000 },
      { id: 4, ts: 5100 },
    ])

    const count = generateSessionIndex(db, 2000)
    assert.equal(count, 2)
    assert.equal(db.tables.segment.length, 2)
    assert.equal(db.tables.message_context.length, 4)
  })

  it('puts all messages in one session when gap is large enough', () => {
    const db = createInMemoryDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
      { id: 3, ts: 5000 },
    ])

    const count = generateSessionIndex(db, 99999)
    assert.equal(count, 1)
  })

  it('clears previous sessions before regenerating', () => {
    const db = createInMemoryDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])

    generateSessionIndex(db, 2000)
    assert.equal(db.tables.segment.length, 2)

    generateSessionIndex(db, 99999)
    assert.equal(db.tables.segment.length, 1)
  })

  it('calls onProgress callback', () => {
    const db = createInMemoryDb()
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
    const db = createInMemoryDb()
    assert.deepEqual(getChatSessionList(db), [])
  })

  it('returns sessions with firstMessageId', () => {
    const db = createInMemoryDb()
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
    const db = createInMemoryDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db)

    assert.equal(getSegmentSummary(db, 1), null)
  })

  it('saves and retrieves summary', () => {
    const db = createInMemoryDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db)

    saveSegmentSummary(db, 1, 'Test summary')
    assert.equal(getSegmentSummary(db, 1), 'Test summary')
  })
})

describe('updateSessionGapThreshold', () => {
  it('updates gap threshold in meta', () => {
    const db = createInMemoryDb()
    updateSessionGapThreshold(db, 900)
    assert.equal(db.tables.meta[0].session_gap_threshold, 900)
  })

  it('accepts null to reset', () => {
    const db = createInMemoryDb()
    updateSessionGapThreshold(db, 900)
    updateSessionGapThreshold(db, null)
    assert.equal(db.tables.meta[0].session_gap_threshold, null)
  })
})

describe('clearSessionIndex', () => {
  it('removes all sessions and contexts', () => {
    const db = createInMemoryDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 5000 },
    ])
    generateSessionIndex(db, 2000)
    assert.ok(db.tables.segment.length > 0)

    clearSessionIndex(db)
    assert.equal(db.tables.segment.length, 0)
    assert.equal(db.tables.message_context.length, 0)
  })
})

describe('generateIncrementalSessionIndex', () => {
  it('returns 0 when no new messages', () => {
    const db = createInMemoryDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db)

    const newCount = generateIncrementalSessionIndex(db)
    assert.equal(newCount, 0)
  })

  it('creates new sessions for unindexed messages', () => {
    const db = createInMemoryDb()
    seedMessages(db, [
      { id: 1, ts: 1000 },
      { id: 2, ts: 1100 },
    ])
    generateSessionIndex(db, 2000)
    assert.equal(db.tables.segment.length, 1)

    db.tables.message.push({ id: 3, ts: 50000 })

    const newCount = generateIncrementalSessionIndex(db, 2000)
    assert.equal(newCount, 1)
    assert.equal(db.tables.segment.length, 2)
  })

  it('appends to existing session when within threshold', () => {
    const db = createInMemoryDb()
    seedMessages(db, [{ id: 1, ts: 1000 }])
    generateSessionIndex(db, 2000)

    db.tables.message.push({ id: 2, ts: 1500 })

    const newCount = generateIncrementalSessionIndex(db, 2000)
    assert.equal(newCount, 0, 'should not create new session')
    assert.equal(db.tables.message_context.length, 2)
  })
})
