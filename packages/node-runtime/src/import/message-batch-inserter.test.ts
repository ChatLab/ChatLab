import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { BetterSqliteAdapter } from '../better-sqlite3-adapter'
import { MESSAGE_INSERT_MAX_ROWS, MessageBatchInserter, type MessageInsertRow } from './message-batch-inserter'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')
const messageSchema = `
  CREATE TABLE message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    sender_account_name TEXT,
    sender_group_nickname TEXT,
    ts INTEGER NOT NULL,
    type INTEGER NOT NULL CHECK(type >= 0),
    content TEXT,
    reply_to_message_id TEXT,
    platform_message_id TEXT
  )
`

function makeRows(count: number): MessageInsertRow[] {
  return Array.from({ length: count }, (_, index) => ({
    senderId: (index % 7) + 1,
    senderAccountName: index % 3 === 0 ? null : `account-${index % 7}`,
    senderGroupNickname: index % 4 === 0 ? '' : `nickname-${index % 5}`,
    timestamp: 1_700_000_000 + index,
    type: index % 10,
    content: index % 6 === 0 ? null : `content-${index}`,
    replyToMessageId: index % 8 === 0 ? `reply-${index - 1}` : null,
    platformMessageId: index % 9 === 0 ? null : `message-${index}`,
  }))
}

function readMessages(db: Database.Database): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT
         id,
         sender_id,
         sender_account_name,
         sender_group_nickname,
         ts,
         type,
         content,
         reply_to_message_id,
         platform_message_id
       FROM message
       ORDER BY id`
    )
    .all() as Record<string, unknown>[]
}

test('MessageBatchInserter preserves row order and nullable values across SQLite variable-limit chunks', () => {
  const batchRaw = new Database(':memory:', { nativeBinding })
  const referenceRaw = new Database(':memory:', { nativeBinding })
  batchRaw.exec(messageSchema)
  referenceRaw.exec(messageSchema)

  const rows = makeRows(MESSAGE_INSERT_MAX_ROWS * 2 + 7)
  const statementCount = new MessageBatchInserter(new BetterSqliteAdapter(batchRaw)).insert(rows)
  const referenceInsert = referenceRaw.prepare(
    `INSERT INTO message (
       sender_id,
       sender_account_name,
       sender_group_nickname,
       ts,
       type,
       content,
       reply_to_message_id,
       platform_message_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const row of rows) {
    referenceInsert.run(
      row.senderId,
      row.senderAccountName,
      row.senderGroupNickname,
      row.timestamp,
      row.type,
      row.content,
      row.replyToMessageId,
      row.platformMessageId
    )
  }

  assert.equal(statementCount, 3)
  assert.deepEqual(readMessages(batchRaw), readMessages(referenceRaw))
  batchRaw.close()
  referenceRaw.close()
})

test('MessageBatchInserter failure can roll back the complete active transaction', () => {
  const raw = new Database(':memory:', { nativeBinding })
  raw.exec(messageSchema)
  const db = new BetterSqliteAdapter(raw)
  const rows = makeRows(3)
  rows[1] = { ...rows[1], type: -1 }

  db.exec('BEGIN TRANSACTION')
  assert.throws(() => new MessageBatchInserter(db).insert(rows), /CHECK constraint failed/)
  db.exec('ROLLBACK')

  assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }).count, 0)
  raw.close()
})
