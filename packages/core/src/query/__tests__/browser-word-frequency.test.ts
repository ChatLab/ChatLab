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
    assert.equal(result.totalWords, 6)
    assert.equal(result.uniqueWords, 2)
  })

  it('keeps post-minCount totals when topN truncates the displayed words', () => {
    const result = getBrowserWordFrequency(database, {
      sessionId: 'session-one',
      locale: 'en-US',
      topN: 1,
      minCount: 2,
      posFilterMode: 'all',
      enableStopwords: false,
    })

    assert.deepEqual(result.words, [{ word: 'hello', count: 4, percentage: 100 }])
    assert.equal(result.totalWords, 6)
    assert.equal(result.uniqueWords, 2)
  })

  it('keeps voice transcription words but removes the duration label', () => {
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(6, 1, 600, 0, '[Voice 3s] sample transcript')
    insert.run(7, 1, 700, 0, '[Voice 3s] sample transcript')

    const result = getBrowserWordFrequency(database, {
      sessionId: 'session-one',
      locale: 'en-US',
      topN: 20,
      minCount: 2,
      posFilterMode: 'all',
      enableStopwords: false,
    })

    const words = result.words.map((word) => word.word)
    assert.ok(words.includes('sample'))
    assert.ok(!words.includes('voice'))
  })

  it('excludes explicit system notifications from word frequency', () => {
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(8, 1, 800, 0, '[系统] 对方赞了你分享的 systemnoise')
    insert.run(9, 1, 900, 0, '[系统] 对方赞了你分享的 systemnoise')
    insert.run(10, 1, 1000, 5, '[强壮]')
    insert.run(11, 1, 1100, 0, '[分享内容] share_noise')
    insert.run(12, 1, 1200, 0, '[分享内容] share_noise')

    const result = getBrowserWordFrequency(database, {
      sessionId: 'session-one',
      locale: 'en-US',
      topN: 20,
      minCount: 1,
      posFilterMode: 'all',
      enableStopwords: false,
    })

    const words = result.words.map((word) => word.word)
    assert.ok(!words.includes('systemnoise'))
    assert.ok(!words.includes('share_noise'))
    assert.equal(result.totalMessages, 4)
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
