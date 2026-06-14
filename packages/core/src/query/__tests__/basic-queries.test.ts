/**
 * Tests for the text/length statistics queries migrated from the plugin charts:
 *   getTextStats, getLongMessageCount, getMemberMonthlyTrend, getTextLengthPercentiles.
 *
 * Uses a real in-memory SQLite DB to lock the SQL + post-processing behavior,
 * including system-message exclusion and member/time filtering.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/basic-queries.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { getTextStats, getLongMessageCount, getMemberMonthlyTrend, getTextLengthPercentiles } from '../basic-queries'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'

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

// 2024-01-15 12:00:00 UTC, 时区偏移不会跨出 2024-01
const TS = 1705320000

describe('basic-queries text/length stats', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = new Database(':memory:')
    raw.exec(`
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT, avatar TEXT);
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice'), (2, 'u2', 'Bob'), (99, 'sys', '系统消息');
    `)
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    // Alice 文字消息 长度 3 / 6 / 40
    insert.run(1, 1, TS, 0, 'a'.repeat(3))
    insert.run(2, 1, TS, 0, 'a'.repeat(6))
    insert.run(3, 1, TS, 0, 'a'.repeat(40))
    // Bob 文字消息 长度 2 / 10
    insert.run(4, 2, TS, 0, 'b'.repeat(2))
    insert.run(5, 2, TS, 0, 'b'.repeat(10))
    // Alice 非文字消息（type!=0）应忽略
    insert.run(6, 1, TS, 1, 'image-url')
    // 系统消息成员的长文字消息应被系统过滤排除
    insert.run(7, 99, TS, 0, 's'.repeat(50))
    db = new Adapter(raw)
  })

  afterEach(() => {
    try {
      raw.close()
    } catch {
      /* already closed */
    }
  })

  it('getTextStats aggregates text-only, excludes system messages', () => {
    // 长度 [3,6,40,2,10] -> count5, avg=12.2, max40, short(<=5)=2
    assert.deepEqual(getTextStats(db), { textCount: 5, avgLength: 12.2, maxLength: 40, shortCount: 2 })
  })

  it('getTextStats honors memberId filter', () => {
    // Alice 长度 [3,6,40] -> count3, avg=16.3, max40, short=1
    assert.deepEqual(getTextStats(db, { memberId: 1 }), {
      textCount: 3,
      avgLength: 16.3,
      maxLength: 40,
      shortCount: 1,
    })
  })

  it('getTextStats returns zeros when no text messages match', () => {
    // 系统成员被过滤后无文字消息
    assert.deepEqual(getTextStats(db, { memberId: 99 }), {
      textCount: 0,
      avgLength: 0,
      maxLength: 0,
      shortCount: 0,
    })
  })

  it('getTextLengthPercentiles computes percentiles over sorted lengths', () => {
    // sorted [2,3,6,10,40] -> p25=3, p50=6, p75=10, p90=40
    assert.deepEqual(getTextLengthPercentiles(db), { p25: 3, p50: 6, p75: 10, p90: 40 })
  })

  it('getTextLengthPercentiles returns zeros on empty set', () => {
    assert.deepEqual(getTextLengthPercentiles(db, { memberId: 99 }), { p25: 0, p50: 0, p75: 0, p90: 0 })
  })

  it('getLongMessageCount counts text >= minLength (default 30)', () => {
    assert.equal(getLongMessageCount(db), 1) // 仅长度 40
    assert.equal(getLongMessageCount(db, undefined, 10), 2) // 长度 40 与 10
    assert.equal(getLongMessageCount(db, { memberId: 2 }, 10), 1) // Bob 仅长度 10
  })

  it('getMemberMonthlyTrend groups by month and sender, excludes system', () => {
    const rows = getMemberMonthlyTrend(db)
    // Alice 3 文字+1 非文字=4 条；Bob 2 条；系统成员排除
    assert.equal(rows.length, 2)
    const alice = rows.find((r) => r.memberId === 1)
    const bob = rows.find((r) => r.memberId === 2)
    assert.deepEqual(alice, { month: '2024-01', memberId: 1, memberName: 'Alice', count: 4 })
    assert.deepEqual(bob, { month: '2024-01', memberId: 2, memberName: 'Bob', count: 2 })
    assert.equal(
      rows.find((r) => r.memberId === 99),
      undefined
    )
  })
})
