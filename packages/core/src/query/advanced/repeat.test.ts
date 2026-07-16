import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '../../interfaces'
import { getLanguagePreferenceAnalysis } from './languagePreference'
import { getCatchphraseAnalysis } from './repeat'

class SqliteStatement implements PreparedStatement {
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

  prepare(sql: string) {
    return new SqliteStatement(this.database.prepare(sql))
  }

  exec(sql: string) {
    this.database.exec(sql)
  }

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn)()
  }

  pragma(source: string) {
    return this.database.pragma(source)
  }

  close() {
    this.database.close()
  }
}

interface MockRow {
  [key: string]: unknown
  memberId: number
  platformId?: string
  name: string
  content: string
  count?: number
}

function createRowsDb(rows: MockRow[]): DatabaseAdapter {
  return {
    prepare(): PreparedStatement {
      return {
        get() {
          return undefined
        },
        all() {
          return rows
        },
        run() {
          return { changes: 0, lastInsertRowid: 0 }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    exec() {},
    transaction<T>(fn: () => T) {
      return fn()
    },
    pragma() {
      return undefined
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {},
  }
}

interface CatchphraseFixture {
  memberId: number
  content: string
  count: number
}

function createCatchphraseDb(fixtures: CatchphraseFixture[]): DatabaseAdapter {
  const database = new Database(':memory:')
  database.exec(`
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
    INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES
      (1, 'alice', 'Alice', NULL),
      (2, 'bob', 'Bob', NULL);
  `)

  const insert = database.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, 0, ?)')
  let messageId = 1
  for (const fixture of fixtures) {
    for (let index = 0; index < fixture.count; index += 1) {
      insert.run(messageId, fixture.memberId, 1_700_000_000 + messageId, fixture.content)
      messageId += 1
    }
  }

  return new SqliteAdapter(database)
}

describe('getCatchphraseAnalysis', () => {
  it('keeps repeated phrases and filters single-use messages and QQ reply placeholders', () => {
    const db = createCatchphraseDb([
      { memberId: 1, content: '[回复消息]', count: 10 },
      { memberId: 1, content: '收到', count: 3 },
      { memberId: 1, content: '只说一次', count: 1 },
    ])

    const result = getCatchphraseAnalysis(db)

    assert.deepEqual(result.members[0]?.catchphrases, [{ content: '收到', count: 3 }])
    db.close()
  })

  it('orders members by their strongest catchphrase instead of total phrase occurrences', () => {
    const db = createCatchphraseDb([
      { memberId: 1, content: '收到', count: 4 },
      { memberId: 1, content: '可以', count: 4 },
      { memberId: 2, content: '知道了', count: 5 },
    ])

    const result = getCatchphraseAnalysis(db)

    assert.deepEqual(
      result.members.map((member) => member.name),
      ['Bob', 'Alice']
    )
    db.close()
  })

  it('honors the selected member filter', () => {
    const db = createCatchphraseDb([
      { memberId: 1, content: '收到', count: 3 },
      { memberId: 2, content: '知道了', count: 4 },
    ])

    const result = getCatchphraseAnalysis(db, { memberId: 2 })

    assert.deepEqual(
      result.members.map((member) => member.name),
      ['Bob']
    )
    db.close()
  })
})

describe('getLanguagePreferenceAnalysis', () => {
  it('filters QQ reply placeholders from phrase frequency results', () => {
    const db = createRowsDb([
      { memberId: 1, name: 'Alice', content: '[回复消息]' },
      { memberId: 1, name: 'Alice', content: '[回复消息]' },
      { memberId: 2, name: 'Bob', content: 'noted' },
      { memberId: 2, name: 'Bob', content: 'noted' },
    ])

    const result = getLanguagePreferenceAnalysis(db, { locale: 'en-US' })

    assert.equal(result.members.length, 1)
    assert.equal(result.members[0]?.name, 'Bob')
    assert.equal(result.members[0]?.totalMessages, 2)
    assert.deepEqual(result.members[0]?.catchphrases, [{ content: 'noted', count: 2 }])
  })
})
