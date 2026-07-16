/**
 * Tests for shared social analysis queries and graph helpers.
 *
 * Run: pnpm test -- packages/core/src/query/advanced/__tests__/social.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { accumulateCoOccurrencePairs, getMentionAnalysis } from '../social'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../../interfaces'

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

function createMentionDatabase(): Adapter {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT,
      account_name TEXT,
      group_nickname TEXT
    );
    CREATE TABLE member_name_history (member_id INTEGER, name TEXT);
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER,
      ts INTEGER,
      type INTEGER,
      content TEXT
    );
    INSERT INTO member (id, platform_id, account_name) VALUES
      (1, 'u1', 'Alice'),
      (2, 'u2', 'Bob'),
      (3, 'u3', 'Carol');
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 1, 0, '@Bob'),
      (2, 1, 2, 0, '@Bob'),
      (3, 1, 3, 0, '@Bob'),
      (4, 1, 4, 0, '@Carol'),
      (5, 2, 5, 0, '@Alice'),
      (6, 2, 6, 0, '@Alice');
  `)
  return new Adapter(database)
}

describe('social analysis', () => {
  it('tracks the latest timestamp for each co-occurrence pair', () => {
    const pairs = accumulateCoOccurrencePairs([
      { senderId: 1, ts: 1704103200 },
      { senderId: 2, ts: 1704103260 },
      { senderId: 1, ts: 1704103320 },
      { senderId: 2, ts: 1704103380 },
      { senderId: 3, ts: 1704107000 },
    ])

    const ownerAlice = pairs.find((pair) => pair.sourceId === 1 && pair.targetId === 2)

    assert.ok(ownerAlice)
    assert.equal(ownerAlice.lastOccurrenceTs, 1704103380)
  })

  it('uses unix seconds directly for co-occurrence decay', () => {
    const closePair = accumulateCoOccurrencePairs(
      [
        { senderId: 1, ts: 1704103200 },
        { senderId: 2, ts: 1704103260 },
      ],
      { decaySeconds: 120 }
    )[0]
    const distantPair = accumulateCoOccurrencePairs(
      [
        { senderId: 1, ts: 1704103200 },
        { senderId: 2, ts: 1704106800 },
      ],
      { decaySeconds: 120 }
    )[0]

    assert.ok(closePair)
    assert.ok(distantPair)
    assert.ok(closePair.rawScore > 0.6)
    assert.ok(distantPair.rawScore < 0.001)
  })

  it('returns only the two member rankings and total mention count', () => {
    const database = createMentionDatabase()

    try {
      assert.deepEqual(getMentionAnalysis(database), {
        topMentioners: [
          { memberId: 1, platformId: 'u1', name: 'Alice', count: 4, percentage: 66.67 },
          { memberId: 2, platformId: 'u2', name: 'Bob', count: 2, percentage: 33.33 },
        ],
        topMentioned: [
          { memberId: 2, platformId: 'u2', name: 'Bob', count: 3, percentage: 50 },
          { memberId: 1, platformId: 'u1', name: 'Alice', count: 2, percentage: 33.33 },
          { memberId: 3, platformId: 'u3', name: 'Carol', count: 1, percentage: 16.67 },
        ],
        totalMentions: 6,
      })
    } finally {
      database.close()
    }
  })
})
