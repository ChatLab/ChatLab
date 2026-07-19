import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { CHAT_DB_SCHEMA } from '../../schema'
import { buildMemberIdMap, writeParseResultToDb } from '../writers'
import type { DatabaseAdapter } from '../../interfaces'

function createMockDb(members: Array<{ id: number; platform_id: string }>): DatabaseAdapter {
  return {
    prepare: (_sql: string) => ({
      all: () => [...members],
      get: () => undefined,
      run: () => ({ changes: 0 }),
    }),
    exec: () => {},
    transaction: <T>(fn: () => T) => fn(),
    pragma: () => undefined,
    close: () => {},
  }
}

describe('buildMemberIdMap', () => {
  it('returns empty map for empty member table', () => {
    const db = createMockDb([])
    const map = buildMemberIdMap(db)
    assert.equal(map.size, 0)
  })

  it('maps platform_id to internal row id', () => {
    const db = createMockDb([
      { id: 1, platform_id: 'alice' },
      { id: 2, platform_id: 'bob' },
      { id: 3, platform_id: 'charlie' },
    ])
    const map = buildMemberIdMap(db)
    assert.equal(map.size, 3)
    assert.equal(map.get('alice'), 1)
    assert.equal(map.get('bob'), 2)
    assert.equal(map.get('charlie'), 3)
  })

  it('returns undefined for unknown platform_id', () => {
    const db = createMockDb([{ id: 1, platform_id: 'alice' }])
    const map = buildMemberIdMap(db)
    assert.equal(map.get('unknown'), undefined)
  })
})

describe('writeParseResultToDb', () => {
  it('writes metadata, members, messages, and name history in one real SQLite transaction', () => {
    const raw = new DatabaseSync(':memory:')
    const db = createNodeSqliteAdapter(raw)
    db.exec(CHAT_DB_SCHEMA)

    const stats = writeParseResultToDb(
      db,
      { name: 'Browser fixture', platform: 'wechat', type: 'group', ownerId: 'alice' },
      [
        { platformId: 'alice', accountName: 'Alice' },
        { platformId: 'bob', accountName: 'Bob' },
      ],
      [
        {
          senderPlatformId: 'alice',
          senderAccountName: 'Alice 2',
          timestamp: 2,
          type: 0,
          content: 'second',
        },
        {
          senderPlatformId: 'alice',
          senderAccountName: 'Alice',
          timestamp: 1,
          type: 0,
          content: 'first',
        },
        {
          senderPlatformId: 'missing',
          senderAccountName: 'Missing',
          timestamp: 3,
          type: 0,
          content: 'skipped',
        },
      ]
    )

    assert.deepEqual(stats, { messageCount: 2, memberCount: 2, skippedCount: 1 })
    assert.deepEqual(db.prepare('SELECT name, platform, type, owner_id FROM meta').get(), {
      name: 'Browser fixture',
      platform: 'wechat',
      type: 'group',
      owner_id: 'alice',
    })
    assert.deepEqual(db.prepare('SELECT ts, content FROM message ORDER BY ts').all(), [
      { ts: 1, content: 'first' },
      { ts: 2, content: 'second' },
    ])
    assert.deepEqual(db.prepare('SELECT name, start_ts, end_ts FROM member_name_history ORDER BY start_ts').all(), [
      { name: 'Alice', start_ts: 1, end_ts: 2 },
      { name: 'Alice 2', start_ts: 2, end_ts: null },
    ])
    assert.deepEqual(db.prepare("SELECT account_name FROM member WHERE platform_id = 'alice'").get(), {
      account_name: 'Alice 2',
    })

    db.close()
  })
})

function createNodeSqliteAdapter(raw: DatabaseSync): DatabaseAdapter {
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql)
      statement.setReturnArrays(false)
      return {
        get: (...params) => {
          const row = statement.get(...params.map(toSqlInput))
          return row ? { ...row } : undefined
        },
        all: (...params) => statement.all(...params.map(toSqlInput)).map((row) => ({ ...row })),
        run: (...params) => {
          const result = statement.run(...params.map(toSqlInput))
          return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
        },
      }
    },
    transaction: <T>(fn: () => T): T => {
      raw.exec('BEGIN')
      try {
        const result = fn()
        raw.exec('COMMIT')
        return result
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
    pragma: (pragma) => raw.prepare(`PRAGMA ${pragma}`).get(),
    close: () => raw.close(),
  }
}

function toSqlInput(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value
  }
  throw new TypeError(`Unsupported SQLite test value: ${typeof value}`)
}
