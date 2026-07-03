/**
 * Tests for word frequency blacklist pushdown (agent-friendly CLI, P3).
 *
 * Messages containing a blacklisted keyword must be excluded from segmentation
 * entirely (message-level SQL pushdown), so their vocabulary never reaches the
 * agent-facing `stats keywords` output. Uses en-US locale (Intl.Segmenter, no
 * jieba dependency) with a real in-memory SQLite DB.
 *
 * Run: npx tsx --test packages/node-runtime/src/nlp/word-frequency.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '@openchatlab/core'
import { computeWordFrequency } from './word-frequency'
import { openTestSqliteDatabase } from '../../../../tests/helpers/sqlite.mts'

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

describe('computeWordFrequency excludeKeywords pushdown', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = openTestSqliteDatabase()
    raw.exec(`
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT);
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice');
    `)
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(1, 1, 1000, 0, 'travel planning together travel')
    insert.run(2, 1, 2000, 0, 'secretproject travel budget meeting')
    insert.run(3, 1, 3000, 0, 'dinner planning tonight')
    db = new Adapter(raw)
  })

  afterEach(() => {
    raw.close()
  })

  it('excludes blacklisted messages from segmentation and message count', () => {
    const result = computeWordFrequency(db, {
      sessionId: 's1',
      locale: 'en-US',
      minCount: 1,
      excludeKeywords: ['secretproject'],
    })

    assert.equal(result.totalMessages, 2)
    const words = result.words.map((w) => w.word)
    assert.ok(!words.includes('secretproject'))
    assert.ok(!words.includes('budget'))
    assert.ok(words.includes('travel'))
  })

  it('escapes SQL wildcards in blacklist keywords', () => {
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(4, 1, 4000, 0, 'discount 100% offer today')

    const result = computeWordFrequency(db, {
      sessionId: 's1',
      locale: 'en-US',
      minCount: 1,
      excludeKeywords: ['100%'],
    })

    // only the literal '100%' message is excluded
    assert.equal(result.totalMessages, 3)
    // '%' is treated literally: it excludes only messages containing a percent
    // sign, instead of acting as a match-all wildcard that wipes everything
    const wildcard = computeWordFrequency(db, {
      sessionId: 's1',
      locale: 'en-US',
      minCount: 1,
      excludeKeywords: ['%'],
    })
    assert.equal(wildcard.totalMessages, 3)
  })
})
