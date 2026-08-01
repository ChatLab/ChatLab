/**
 * Tests for member query functions against real SQLite behavior.
 *
 * Run: npx tsx --test packages/core/src/query/__tests__/member-queries.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getMemberNameHistory, getMembersPaginated, getMembersWithAliases } from '../message-queries'
import { SqliteTestAdapter } from './sqlite-test-adapter'

function createMemberDb(options: { legacyColumns?: boolean; historyTable?: boolean } = {}): SqliteTestAdapter {
  const db = new SqliteTestAdapter()
  const optionalColumns = options.legacyColumns ? '' : ", aliases TEXT DEFAULT '[]', avatar TEXT"
  db.exec(`
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT NOT NULL,
      account_name TEXT,
      group_nickname TEXT
      ${optionalColumns}
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER NOT NULL,
      sender_account_name TEXT,
      sender_group_nickname TEXT,
      ts INTEGER NOT NULL,
      type INTEGER NOT NULL,
      content TEXT
    );
    ${
      options.historyTable === false
        ? ''
        : `CREATE TABLE member_name_history (
            id INTEGER PRIMARY KEY,
            member_id INTEGER NOT NULL,
            name_type TEXT NOT NULL,
            name TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER
          );`
    }
  `)

  const insertMember = options.legacyColumns
    ? db.prepare('INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES (?, ?, ?, ?)')
    : db.prepare(
        'INSERT INTO member (id, platform_id, account_name, group_nickname, aliases, avatar) VALUES (?, ?, ?, ?, ?, ?)'
      )

  const members = [
    [1, 'u1', 'Alice', 'A', '["小A"]', 'data:img1'],
    [2, 'u2', 'Bob', null, '[]', null],
    [3, 'u3', 'Carol', 'C', null, 'data:img3'],
    [4, 'sys', '系统消息', '系统消息', null, null],
    [5, 'u5', 'Eve', null, '["Evie"]', null],
  ] as const
  for (const row of members) {
    insertMember.run(...(options.legacyColumns ? row.slice(0, 4) : row))
  }

  const insertMessage = db.prepare(
    `INSERT INTO message
      (id, sender_id, sender_account_name, sender_group_nickname, ts, type, content)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  )
  const messages = [
    [1, 1, 'Alice', 'A', 1000, 'a1'],
    [2, 1, 'Alice', 'A', 1500, 'a2'],
    [3, 1, 'Alice Chen', null, 3000, 'a3'],
    [4, 2, 'Bob', null, 1200, 'b1'],
    [5, 2, 'Bob', null, 2000, 'b2'],
    [6, 5, 'Eve', null, 1100, 'e1'],
    [7, 5, 'Eve', null, 1300, 'e2'],
    [8, 5, 'Eve', null, 2500, 'e3'],
    [9, 4, '系统消息', '系统消息', 4000, 'system'],
  ] as const
  for (const message of messages) insertMessage.run(...message)
  return db
}

describe('getMembersWithAliases', () => {
  it('returns profile data ordered by activity with stable id ties', () => {
    const db = createMemberDb()
    const result = getMembersWithAliases(db)

    assert.deepEqual(
      result.map(({ id, messageCount, lastMessageTs }) => ({ id, messageCount, lastMessageTs })),
      [
        { id: 1, messageCount: 3, lastMessageTs: 3000 },
        { id: 5, messageCount: 3, lastMessageTs: 2500 },
        { id: 2, messageCount: 2, lastMessageTs: 2000 },
        { id: 3, messageCount: 0, lastMessageTs: null },
      ]
    )
    assert.deepEqual(result[0]?.aliases, ['小A'])
    assert.equal(result[0]?.avatar, 'data:img1')
    db.close()
  })

  it('uses profile defaults with a legacy member schema', () => {
    const db = createMemberDb({ legacyColumns: true })
    const result = getMembersWithAliases(db)

    assert.equal(result.length, 4)
    assert.equal(
      result.every((member) => member.aliases.length === 0 && member.avatar === null),
      true
    )
    db.close()
  })
})

describe('getMemberNameHistory', () => {
  const expectedFallback = [
    { nameType: 'account_name', name: 'Alice', startTs: 1000, endTs: 1500 },
    { nameType: 'group_nickname', name: 'A', startTs: 1000, endTs: 1500 },
    { nameType: 'account_name', name: 'Alice Chen', startTs: 3000, endTs: 3000 },
  ]

  it('uses stored history when available', () => {
    const db = createMemberDb()
    db.prepare(
      `INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts)
       VALUES (?, ?, ?, ?, ?)`
    ).run(1, 'account_name', 'Stored Alice', 500, 900)

    assert.deepEqual(getMemberNameHistory(db, 1), [
      { nameType: 'account_name', name: 'Stored Alice', startTs: 500, endTs: 900 },
    ])
    db.close()
  })

  for (const [label, options] of [
    ['the table is absent', { historyTable: false }],
    ['the table is empty', {}],
  ] as const) {
    it(`derives history from messages when ${label}`, () => {
      const db = createMemberDb(options)
      assert.deepEqual(getMemberNameHistory(db, 1), expectedFallback)
      db.close()
    })
  }
})

describe('getMembersPaginated', () => {
  it('paginates the real aggregate query', () => {
    const db = createMemberDb()
    const first = getMembersPaginated(db, { page: 1, pageSize: 2 })
    const second = getMembersPaginated(db, { page: 2, pageSize: 2 })

    assert.deepEqual(
      { total: first.total, totalPages: first.totalPages, ids: first.members.map((member) => member.id) },
      { total: 4, totalPages: 2, ids: [1, 5] }
    )
    assert.deepEqual(
      second.members.map((member) => member.id),
      [2, 3]
    )
    db.close()
  })

  it('searches names, ids, and aliases without including system members', () => {
    const db = createMemberDb()

    assert.equal(getMembersPaginated(db, { search: 'alice' }).members[0]?.id, 1)
    assert.equal(getMembersPaginated(db, { search: 'u2' }).members[0]?.id, 2)
    assert.equal(getMembersPaginated(db, { search: 'Evie' }).members[0]?.id, 5)
    assert.equal(getMembersPaginated(db, { search: '系统消息' }).total, 0)
    db.close()
  })

  it('supports ascending order and deterministic ties', () => {
    const db = createMemberDb()
    const result = getMembersPaginated(db, { sortOrder: 'asc' })

    assert.deepEqual(
      result.members.map((member) => member.id),
      [3, 2, 1, 5]
    )
    db.close()
  })

  it('normalizes pagination bounds and defaults', () => {
    const db = createMemberDb()
    const defaults = getMembersPaginated(db, {})
    const minimum = getMembersPaginated(db, { page: -5, pageSize: 0 })
    const maximum = getMembersPaginated(db, { pageSize: 999 })

    assert.deepEqual([defaults.page, defaults.pageSize], [1, 20])
    assert.deepEqual([minimum.page, minimum.pageSize], [1, 1])
    assert.equal(maximum.pageSize, 100)
    db.close()
  })

  it('works with a legacy member schema', () => {
    const db = createMemberDb({ legacyColumns: true })
    const result = getMembersPaginated(db, { pageSize: 100 })

    assert.equal(result.total, 4)
    assert.equal(
      result.members.every((member) => member.aliases.length === 0 && member.avatar === null),
      true
    )
    db.close()
  })
})
