import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getBrowserWordFrequency } from '../browser-word-frequency'

class StatementAdapter implements PreparedStatement {
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

class SqliteAdapter implements DatabaseAdapter {
  constructor(private readonly database: Database.Database) {}

  exec(sql: string) {
    this.database.exec(sql)
  }

  prepare(sql: string) {
    return new StatementAdapter(this.database.prepare(sql))
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

describe('getBrowserWordFrequency', () => {
  let raw: Database.Database
  let database: SqliteAdapter

  beforeEach(() => {
    raw = new Database(':memory:')
    raw.exec(`
      CREATE TABLE member (
        id INTEGER PRIMARY KEY,
        platform_id TEXT,
        account_name TEXT,
        group_nickname TEXT
      );
      CREATE TABLE message (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER,
        ts INTEGER,
        type INTEGER,
        content TEXT
      );
      INSERT INTO member (id, platform_id, account_name) VALUES
        (1, 'alice', 'Alice'),
        (2, 'bob', 'Bob'),
        (99, 'system', '系统消息');
      INSERT INTO message (id, sender_id, ts, type, content) VALUES
        (1, 1, 100, 0, 'hello project hello'),
        (2, 2, 200, 0, 'hello project'),
        (3, 1, 300, 0, 'hello private'),
        (4, 1, 400, 1, '[Image]'),
        (5, 99, 500, 0, 'hello system');
    `)
    database = new SqliteAdapter(raw)
  })

  afterEach(() => raw.close())

  it('segments browser-safe text and preserves filters without Node NLP dependencies', () => {
    const result = getBrowserWordFrequency(database, {
      sessionId: 'session-one',
      locale: 'en-US',
      topN: 10,
      minCount: 2,
      posFilterMode: 'all',
      enableStopwords: false,
    })

    assert.deepEqual(result.words, [
      { word: 'hello', count: 4, percentage: 66.67 },
      { word: 'project', count: 2, percentage: 33.33 },
    ])
    assert.equal(result.totalMessages, 3)
    assert.equal(result.totalWords, 7)
    assert.equal(result.uniqueWords, 3)
  })

  it('applies member, time, excluded-word, and excluded-message filters', () => {
    const result = getBrowserWordFrequency(database, {
      sessionId: 'session-one',
      locale: 'en-US',
      memberId: 1,
      timeFilter: { endTs: 300 },
      topN: 10,
      minCount: 1,
      posFilterMode: 'all',
      enableStopwords: false,
      excludeWords: ['private'],
      excludeKeywords: ['project'],
    })

    assert.deepEqual(result.words, [{ word: 'hello', count: 1, percentage: 100 }])
    assert.equal(result.totalMessages, 1)
    assert.equal(result.totalWords, 1)
    assert.equal(result.uniqueWords, 1)
  })
})
