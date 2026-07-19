import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { CHAT_DB_INDEXES, CHAT_DB_TABLES, getHourlyActivity } from '@openchatlab/core'
import { SqliteWasmDatabaseAdapter } from './adapter'

describe('SqliteWasmDatabaseAdapter', () => {
  it('runs the core schema and synchronous read/write queries against real SQLite WASM', async () => {
    const sqlite3 = await sqlite3InitModule()
    const rawDb = new sqlite3.oo1.DB(':memory:', 'c')
    const db = new SqliteWasmDatabaseAdapter(sqlite3, rawDb)

    try {
      db.exec(CHAT_DB_TABLES)
      db.exec(CHAT_DB_INDEXES)

      const messageColumns = db.pragma('table_info(message)') as Array<{ name: string }>
      assert.equal(
        messageColumns.some((column) => column.name === 'platform_message_id'),
        true
      )

      const insertMember = db.prepare('INSERT INTO member (platform_id, account_name) VALUES (?, ?)')
      assert.equal(insertMember.readonly, false)
      const firstMember = insertMember.run('alice', 'Alice')
      const secondMember = insertMember.run('bob', 'Bob')
      assert.equal(firstMember.changes, 1)
      assert.equal(Number(firstMember.lastInsertRowid), 1)
      assert.equal(Number(secondMember.lastInsertRowid), 2)

      const insertMessage = db.prepare(`
        INSERT INTO message (sender_id, sender_account_name, ts, type, content)
        VALUES (?, ?, ?, ?, ?)
      `)
      db.transaction(() => {
        insertMessage.run(1, 'Alice', Math.floor(new Date(2026, 0, 1, 9).getTime() / 1000), 0, 'first')
        insertMessage.run(2, 'Bob', Math.floor(new Date(2026, 0, 1, 9, 30).getTime() / 1000), 0, 'second')
      })

      const selectMembers = db.prepare('SELECT id, platform_id FROM member ORDER BY id')
      assert.equal(selectMembers.readonly, true)
      assert.deepEqual(selectMembers.all(), [
        { id: 1, platform_id: 'alice' },
        { id: 2, platform_id: 'bob' },
      ])
      assert.deepEqual(selectMembers.get(), { id: 1, platform_id: 'alice' })
      assert.equal(db.prepare('SELECT id FROM member WHERE platform_id = ?').get('missing'), undefined)

      const hourly = getHourlyActivity(db)
      assert.equal(hourly.find((bucket) => bucket.hour === 9)?.messageCount, 2)
    } finally {
      db.close()
    }

    assert.equal(rawDb.isOpen(), false)
  })

  it('rolls back a failed transaction and remains usable', async () => {
    const sqlite3 = await sqlite3InitModule()
    const rawDb = new sqlite3.oo1.DB(':memory:', 'c')
    const db = new SqliteWasmDatabaseAdapter(sqlite3, rawDb)

    try {
      db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')

      assert.throws(
        () =>
          db.transaction(() => {
            db.prepare('INSERT INTO probe (value) VALUES (?)').run('rolled-back')
            throw new Error('transaction failed')
          }),
        /transaction failed/
      )

      assert.deepEqual(db.prepare('SELECT COUNT(*) AS count FROM probe').get(), { count: 0 })
      db.prepare('INSERT INTO probe (value) VALUES (?)').run('after-rollback')
      assert.deepEqual(db.prepare('SELECT value FROM probe').all(), [{ value: 'after-rollback' }])
    } finally {
      db.close()
    }
  })
})
