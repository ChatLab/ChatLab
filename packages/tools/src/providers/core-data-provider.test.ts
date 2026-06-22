/**
 * CoreDataProvider 关键词搜索回归测试。
 *
 * 重点锁定历史 bug：多关键词被 join(' ') 拼成单子串，导致 CLI/MCP/Web 下
 * search_messages / deep_search_messages 在多关键词时永远返回 0。
 * 这里用真实内存 SQLite 验证多关键词 OR 命中、时间/发送者过滤与系统消息排除。
 *
 * Run: npx tsx --test packages/tools/src/providers/core-data-provider.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { CoreDataProvider } from './core-data-provider'
import type { DatabaseAdapter, PreparedStatement, RunResult } from '@openchatlab/core'
import { openTestSqliteDatabase } from '../../../../tests/helpers/sqlite.mts'

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

const T0 = 1700000000

describe('CoreDataProvider keyword search', () => {
  let raw: Database.Database
  let provider: CoreDataProvider

  beforeEach(() => {
    raw = openTestSqliteDatabase()
    raw.exec(`
      CREATE TABLE member (
        id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT,
        group_nickname TEXT, aliases TEXT, avatar TEXT
      );
      CREATE TABLE message (
        id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER,
        content TEXT, reply_to_message_id TEXT, platform_message_id TEXT
      );
      INSERT INTO member (id, platform_id, account_name) VALUES
        (1, 'u1', '小红'), (2, 'u2', '地瓜'), (99, 'sys', '系统消息');
    `)
    const ins = raw.prepare('INSERT INTO message (id, sender_id, ts, type, content) VALUES (?, ?, ?, ?, ?)')
    ins.run(1, 1, T0 + 1, 0, '今晚来打麻将吗')
    ins.run(2, 2, T0 + 2, 0, '我更想玩扑克')
    ins.run(3, 1, T0 + 3, 0, '不如吃个火锅')
    ins.run(4, 2, T0 + 100, 0, '周末再约麻将')
    // 系统消息含关键词，应被排除
    ins.run(5, 99, T0 + 4, 0, '系统播报：麻将房已创建')
    provider = new CoreDataProvider(new Adapter(raw))
  })

  afterEach(() => {
    try {
      raw.close()
    } catch {
      /* already closed */
    }
  })

  it('multi-keyword search uses OR (regression: previously joined into one substring → 0)', async () => {
    const r = await provider.searchMessages(['麻将', '扑克'])
    // 命中 id 1/2/4（系统消息 id5 排除），而不是查找字面串 "麻将 扑克"
    assert.equal(r.total, 3)
    const ids = r.messages.map((m) => m.id as number).sort((a, b) => a - b)
    assert.deepEqual(ids, [1, 2, 4])
  })

  it('single keyword still works', async () => {
    const r = await provider.searchMessages(['麻将'])
    assert.equal(r.total, 2)
  })

  it('excludes system messages', async () => {
    const r = await provider.searchMessages(['麻将'])
    assert.ok(!r.messages.some((m) => m.id === 5))
  })

  it('honors timeFilter', async () => {
    const r = await provider.searchMessages(['麻将'], {
      timeFilter: { startTs: T0 + 50, endTs: T0 + 200 },
    })
    assert.equal(r.total, 1)
    assert.equal(r.messages[0].id, 4)
  })

  it('honors senderId', async () => {
    const r = await provider.searchMessages(['麻将'], { senderId: 1 })
    assert.equal(r.total, 1)
    assert.equal(r.messages[0].id, 1)
  })

  it('deepSearchMessages also supports multi-keyword OR', async () => {
    const r = await provider.deepSearchMessages(['麻将', '扑克'])
    assert.equal(r.total, 3)
  })
})
