/**
 * FetchSessionIndexAdapter 回归测试
 *
 * 回归点：时间线点击会话跳转依赖 ChatSessionItem.firstMessageId。
 * 重构统一查询后，getSessions/getByTimeRange/getRecent 的 SQL 一度漏掉
 * firstMessageId 子查询，导致桌面端与 CLI Web 点击会话都无法跳转。
 * 这里用内存 SQLite 验证三个查询都能返回正确的首条消息 ID。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { FetchSessionIndexAdapter } from './fetch'
import { registerAdapter } from '../registry'
import type { DataAdapter } from '../data/types'

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE segment (
      id INTEGER PRIMARY KEY,
      start_ts INTEGER,
      end_ts INTEGER,
      message_count INTEGER,
      summary TEXT
    );
    CREATE TABLE message_context (
      message_id INTEGER,
      segment_id INTEGER,
      topic_id INTEGER
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL
    );
  `)
  const insSeg = db.prepare('INSERT INTO segment (id, start_ts, end_ts, message_count, summary) VALUES (?, ?, ?, ?, ?)')
  insSeg.run(1, 100, 200, 3, null)
  insSeg.run(2, 300, 400, 2, 'summary-2')

  // 模拟先导入新消息、再回填旧消息，验证首条消息按时间而不是按自增 ID 选择。
  const insMsg = db.prepare('INSERT INTO message (id, ts) VALUES (?, ?)')
  insMsg.run(10, 150)
  insMsg.run(11, 100)
  insMsg.run(12, 200)
  insMsg.run(30, 400)
  insMsg.run(31, 300)

  const insCtx = db.prepare('INSERT INTO message_context (message_id, segment_id, topic_id) VALUES (?, ?, NULL)')
  insCtx.run(11, 1)
  insCtx.run(10, 1)
  insCtx.run(12, 1)
  insCtx.run(31, 2)
  insCtx.run(30, 2)
  return db
}

function registerSqliteDataAdapter(db: Database.Database): void {
  const fake = {
    pluginQuery: async <T>(_sessionId: string, sql: string, params: unknown[] = []): Promise<T[]> =>
      db.prepare(sql).all(...params) as T[],
  } as unknown as DataAdapter
  registerAdapter('data', fake)
}

describe('FetchSessionIndexAdapter firstMessageId', () => {
  it('getSessions 返回按 start_ts 升序且带 firstMessageId 的会话', async () => {
    const db = createDb()
    registerSqliteDataAdapter(db)
    try {
      const sessions = await new FetchSessionIndexAdapter().getSessions('s')
      assert.equal(sessions.length, 2)
      assert.equal(sessions[0].id, 1)
      assert.equal(sessions[0].firstMessageId, 11)
      assert.equal(sessions[1].id, 2)
      assert.equal(sessions[1].firstMessageId, 31)
    } finally {
      db.close()
    }
  })

  it('getRecent 返回带 firstMessageId 的会话', async () => {
    const db = createDb()
    registerSqliteDataAdapter(db)
    try {
      const sessions = await new FetchSessionIndexAdapter().getRecent('s', 10)
      assert.equal(sessions[0].firstMessageId, 31)
      assert.ok(sessions.every((s) => typeof s.firstMessageId === 'number'))
    } finally {
      db.close()
    }
  })

  it('getByTimeRange 返回带 firstMessageId 的会话', async () => {
    const db = createDb()
    registerSqliteDataAdapter(db)
    try {
      const sessions = await new FetchSessionIndexAdapter().getByTimeRange('s', 0, 1000)
      assert.equal(sessions.length, 2)
      assert.equal(sessions[0].firstMessageId, 11)
      assert.equal(sessions[1].firstMessageId, 31)
    } finally {
      db.close()
    }
  })
})
