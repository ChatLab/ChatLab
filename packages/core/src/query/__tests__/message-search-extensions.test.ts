/**
 * Tests for agent-CLI driven search extensions in message-sql / message-queries:
 * keyword AND match mode, blacklist exclusion pushdown (with LIKE escaping),
 * and sort direction. Uses a real in-memory SQLite DB.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { escapeLikePattern, buildMsgConditions } from '../message-sql'
import { searchMessagesByKeywords, getConversationBetween } from '../message-queries'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { openTestSqliteDatabase } from '../../../../../tests/helpers/sqlite.mts'

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

describe('escapeLikePattern', () => {
  it('escapes %, _ and backslash', () => {
    assert.equal(escapeLikePattern('100%'), '100\\%')
    assert.equal(escapeLikePattern('a_b'), 'a\\_b')
    assert.equal(escapeLikePattern('c:\\dir'), 'c:\\\\dir')
    assert.equal(escapeLikePattern('plain'), 'plain')
  })
})

describe('search extensions (in-memory SQLite)', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = openTestSqliteDatabase()
    raw.exec(`
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT, aliases TEXT, avatar TEXT);
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT,
        platform_message_id TEXT, reply_to_message_id TEXT);
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice'), (2, 'u2', 'Bob');
    `)
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(1, 1, 1000, 0, '旅游计划讨论')
    insert.run(2, 2, 2000, 0, '旅游签证的机密文件')
    insert.run(3, 1, 3000, 0, '签证材料准备好了')
    insert.run(4, 2, 4000, 0, '这条消息有 100% 的折扣')
    insert.run(5, 1, 5000, 0, null)
    db = new Adapter(raw)
  })

  afterEach(() => {
    raw.close()
  })

  it('matchMode all requires every keyword (AND)', () => {
    const anyResult = searchMessagesByKeywords(db, ['旅游', '签证'])
    assert.equal(anyResult.total, 3)

    const allResult = searchMessagesByKeywords(db, ['旅游', '签证'], { matchMode: 'all' })
    assert.equal(allResult.total, 1)
    assert.equal(allResult.messages[0].id, 2)
  })

  it('excludeKeywords removes rows from results and total (visible hit counting)', () => {
    const result = searchMessagesByKeywords(db, ['旅游'], { excludeKeywords: ['机密'] })
    assert.equal(result.total, 1)
    assert.deepEqual(
      result.messages.map((m) => m.id),
      [1]
    )
  })

  it('excludeKeywords matches case-insensitively for ASCII', () => {
    raw
      .prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
      .run(6, 1, 6000, 0, '旅游 SECRET plan')
    const result = searchMessagesByKeywords(db, ['旅游'], { excludeKeywords: ['secret'] })
    assert.deepEqual(result.messages.map((m) => m.id).sort(), [1, 2])
  })

  it('excludeKeywords escapes SQL wildcards instead of expanding them', () => {
    // '100%' must match only the literal string, not everything starting with 100
    const result = searchMessagesByKeywords(db, ['折扣'], { excludeKeywords: ['100%'] })
    assert.equal(result.total, 0)

    // an unrelated wildcard-looking keyword must not exclude everything
    const wildcard = searchMessagesByKeywords(db, ['旅游'], { excludeKeywords: ['%'] })
    assert.equal(wildcard.total, 2)
  })

  it('search keywords escape SQL wildcards instead of expanding them', () => {
    raw
      .prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
      .run(6, 1, 6000, 0, '包含_下划线和 100% 符号')

    const underscore = searchMessagesByKeywords(db, ['_'], { sort: 'asc' })
    assert.equal(underscore.total, 1)
    assert.deepEqual(
      underscore.messages.map((m) => m.id),
      [6]
    )

    const percent = searchMessagesByKeywords(db, ['%'], { sort: 'asc' })
    assert.equal(percent.total, 2)
    assert.deepEqual(
      percent.messages.map((m) => m.id),
      [4, 6]
    )
  })

  it('excludeKeywords keeps NULL-content rows (parity with pipeline blacklist)', () => {
    const { clause, params } = buildMsgConditions({ excludeKeywords: ['机密'] })
    const row = db
      .prepare(`SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id WHERE 1=1 ${clause}`)
      .get(...params) as { total: number }
    assert.equal(row.total, 4)
  })

  it('sort asc returns oldest hits first; default stays desc', () => {
    const asc = searchMessagesByKeywords(db, ['签证'], { sort: 'asc' })
    assert.deepEqual(
      asc.messages.map((m) => m.id),
      [2, 3]
    )

    const desc = searchMessagesByKeywords(db, ['签证'])
    assert.deepEqual(
      desc.messages.map((m) => m.id),
      [3, 2]
    )
  })

  it('uses id as a tie-breaker for same-second search paging', () => {
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(6, 1, 7000, 0, '同秒消息')
    insert.run(7, 2, 7000, 0, '同秒消息')

    const asc = searchMessagesByKeywords(db, ['同秒'], { sort: 'asc' })
    assert.deepEqual(
      asc.messages.map((m) => m.id),
      [6, 7]
    )

    const desc = searchMessagesByKeywords(db, ['同秒'])
    assert.deepEqual(
      desc.messages.map((m) => m.id),
      [7, 6]
    )
  })
})

describe('getConversationBetween pagination and blacklist (in-memory SQLite)', () => {
  let raw: Database.Database
  let db: Adapter

  beforeEach(() => {
    raw = openTestSqliteDatabase()
    raw.exec(`
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT);
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT);
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'u1', 'Alice'), (2, 'u2', 'Bob'), (3, 'u3', 'Carol');
    `)
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(1, 1, 1000, 0, '你好')
    insert.run(2, 2, 2000, 0, '你好 Alice')
    insert.run(3, 1, 3000, 0, '这是机密内容')
    insert.run(4, 2, 4000, 0, '晚上吃什么')
    insert.run(5, 3, 4500, 0, '路人消息')
    insert.run(6, 1, 5000, 0, '吃火锅吧')
    db = new Adapter(raw)
  })

  afterEach(() => {
    raw.close()
  })

  it('supports offset paging over the recency-ordered sequence', () => {
    const page1 = getConversationBetween(db, 1, 2, undefined, 2)
    assert.deepEqual(
      page1.messages.map((m) => m.id),
      [4, 6]
    )
    assert.equal(page1.total, 5)

    const page2 = getConversationBetween(db, 1, 2, undefined, 2, { offset: 2 })
    assert.deepEqual(
      page2.messages.map((m) => m.id),
      [2, 3]
    )
  })

  it('uses id as a tie-breaker for same-second between paging', () => {
    const insert = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    insert.run(7, 1, 6000, 0, '同秒 A')
    insert.run(8, 2, 6000, 0, '同秒 B')

    const page = getConversationBetween(db, 1, 2, undefined, 2)
    assert.deepEqual(
      page.messages.map((m) => m.id),
      [7, 8]
    )
  })

  it('excludeKeywords removes rows from both page and total (visible counting)', () => {
    const result = getConversationBetween(db, 1, 2, undefined, 10, { excludeKeywords: ['机密'] })
    assert.equal(result.total, 4)
    assert.ok(!result.messages.some((m) => m.content?.includes('机密')))
  })
})
