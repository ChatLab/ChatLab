import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import { openBetterSqliteDatabase, type BetterSqliteAdapter } from '../../better-sqlite3-adapter'
import { createChatDbMessageSource } from './message-source'
import { createChatDbMessageRangeReader } from './message-range-reader'

function makeChatDb(): { db: BetterSqliteAdapter; dir: string } {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-chatdb-'))
  const db = openBetterSqliteDatabase(path.join(dir, 'chat.db'))
  db.exec(CHAT_DB_SCHEMA)

  db.exec(`
    INSERT INTO member (id, platform_id, account_name, group_nickname) VALUES
      (1, 'p1', '张三', '群里的张三'),
      (2, 'p2', '李四', NULL);
    INSERT INTO message (id, sender_id, ts, type, content) VALUES
      (1, 1, 1000, 0, '今天我们讨论一下项目排期'),
      (2, 2, 1010, 0, '好的，我觉得需要先确认需求'),
      (3, 1, 1020, 1, NULL),
      (4, 2, 1030, 0, '排期可以放到下周一');
  `)
  return { db, dir }
}

test('message source returns all messages ordered with ms timestamps and resolved sender', () => {
  const { db } = makeChatDb()
  const source = createChatDbMessageSource(db, { title: '测试群', kind: 'group' })

  assert.equal(source.countMessages(), 4)
  const messages = source.readAllMessages()
  assert.equal(messages.length, 4)
  assert.deepEqual(
    messages.map((m) => m.id),
    [1, 2, 3, 4]
  )
  // ts 秒 -> 毫秒
  assert.equal(messages[0].ts, 1000 * 1000)
  // group_nickname 优先于 account_name
  assert.equal(messages[0].senderName, '群里的张三')
  // 无 group_nickname 时回退 account_name
  assert.equal(messages[1].senderName, '李四')
  // 非文本消息保留在序列中
  assert.equal(messages[2].type, 1)
  assert.equal(messages[2].content, null)
  db.close()
})

test('range reader returns inclusive id range including non-text messages', () => {
  const { db } = makeChatDb()
  const reader = createChatDbMessageRangeReader(db)

  const range = reader.readRange(2, 3)
  assert.deepEqual(
    range.map((m) => m.id),
    [2, 3]
  )
  // 非文本 content 归一为空串
  assert.equal(range[1].content, '')
  assert.equal(range[0].ts, 1010 * 1000)
  db.close()
})
