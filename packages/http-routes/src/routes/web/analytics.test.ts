/**
 * analytics 路由缓存接入集成测试。
 *
 * 运行：node --import tsx --test packages/http-routes/src/routes/web/analytics.test.ts
 *
 * 验证目标（接入契约，不重复 core 的算法矩阵）：
 *  1. 同一查询二次请求命中磁盘缓存、不再访问数据库（命中后关闭 db 仍能成功返回）。
 *  2. DB 文件状态变化（mtime/size）使缓存失效，触发重新计算。
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseAdapter, PathProvider, PreparedStatement, RunResult } from '@openchatlab/core'
import type { SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import { registerAnalyticsRoutes } from './analytics'

type AnalyticsRouteContext = Parameters<typeof registerAnalyticsRoutes>[1]

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

const SESSION_ID = 'chat-1'
const MEMBER_ACTIVITY_URL = `/_web/sessions/${SESSION_ID}/stats/member-activity`
const JOURNEY_URL = `/_web/sessions/${SESSION_ID}/analytics/journey`
const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

describe('analytics routes caching', () => {
  let root: string
  let dbFile: string
  let raw: Database.Database
  let app: FastifyInstance

  beforeEach(async () => {
    const base = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
    root = fs.mkdtempSync(path.join(base, 'chatlab-analytics-routes-'))
    dbFile = path.join(root, `${SESSION_ID}.db`)
    raw = new Database(dbFile, { nativeBinding })
    raw.exec(`
      CREATE TABLE member (id INTEGER PRIMARY KEY, platform_id TEXT, account_name TEXT, group_nickname TEXT, avatar TEXT);
      CREATE TABLE message (id INTEGER PRIMARY KEY, sender_id INTEGER, ts INTEGER, type INTEGER, content TEXT, platform_message_id TEXT);
      INSERT INTO member (id, platform_id, account_name) VALUES (1, 'alice', 'Alice'), (2, 'bob', 'Bob');
      INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES
        (1, 1, 100, 0, 'a', 'm-1'), (2, 2, 200, 0, 'b', 'm-2'), (3, 1, 300, 0, 'c', 'm-3');
    `)
    const adapter = new Adapter(raw)

    const pathProvider = {
      getCacheDir: () => path.join(root, 'cache'),
    } as unknown as PathProvider
    const sessionAdapter = {
      ensureReadonly: () => adapter,
      getDbPath: () => dbFile,
    } as unknown as SessionRuntimeAdapter
    const ctx: AnalyticsRouteContext = {
      sessionAdapter,
      pathProvider,
      getVersion: () => 'test',
    }

    app = Fastify()
    registerAnalyticsRoutes(app, ctx)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    try {
      raw.close()
    } catch {
      /* already closed by a test */
    }
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('serves the second identical request from cache without touching the db', async () => {
    const first = await app.inject({ method: 'GET', url: MEMBER_ACTIVITY_URL })
    assert.equal(first.statusCode, 200)
    const firstBody = first.json()
    assert.ok(Array.isArray(firstBody) && firstBody.length === 2)

    // 缓存文件已写入 cacheDir/query
    assert.ok(fs.existsSync(path.join(root, 'cache', 'query', `${SESSION_ID}.cache.json`)))

    // 关闭底层数据库：若二次请求重新计算必然抛错，命中缓存才能成功
    raw.close()

    const second = await app.inject({ method: 'GET', url: MEMBER_ACTIVITY_URL })
    assert.equal(second.statusCode, 200)
    assert.deepEqual(second.json(), firstBody)
  })

  it('recomputes after the db file changes (cache invalidation)', async () => {
    const first = await app.inject({ method: 'GET', url: MEMBER_ACTIVITY_URL })
    assert.equal(first.statusCode, 200)

    // 改变 DB 文件大小 => 版本指纹变化 => 缓存失效。配合关闭连接，重算会抛错。
    raw.close()
    fs.appendFileSync(dbFile, Buffer.from('xx'))

    const second = await app.inject({ method: 'GET', url: MEMBER_ACTIVITY_URL })
    assert.equal(second.statusCode, 500)
  })

  it('keys long-message-count cache by minLength', async () => {
    const base = `/_web/sessions/${SESSION_ID}/analytics/long-message-count`
    const first = await app.inject({ method: 'GET', url: `${base}?minLength=1` })
    assert.equal(first.statusCode, 200)

    raw.close()

    // 相同 minLength => 命中缓存
    const same = await app.inject({ method: 'GET', url: `${base}?minLength=1` })
    assert.equal(same.statusCode, 200)
    assert.deepEqual(same.json(), first.json())

    // 不同 minLength => 缓存未命中、重算因 db 关闭而失败，证明 minLength 进入缓存键
    const diff = await app.inject({ method: 'GET', url: `${base}?minLength=999` })
    assert.equal(diff.statusCode, 500)
  })

  it('keys cluster cache by options so different params recompute', async () => {
    const base = `/_web/sessions/${SESSION_ID}/analytics/cluster`
    const first = await app.inject({ method: 'GET', url: `${base}?lookAhead=3&decaySeconds=120&topEdges=150` })
    assert.equal(first.statusCode, 200)

    // 关闭底层数据库：命中缓存才能成功，重算必然抛错。
    raw.close()

    // 相同参数 => 命中缓存
    const same = await app.inject({ method: 'GET', url: `${base}?lookAhead=3&decaySeconds=120&topEdges=150` })
    assert.equal(same.statusCode, 200)
    assert.deepEqual(same.json(), first.json())

    // 不同参数 => 缓存未命中、重算因 db 关闭而失败，证明 lookAhead 已进入缓存键
    const diff = await app.inject({ method: 'GET', url: `${base}?lookAhead=10&decaySeconds=120&topEdges=150` })
    assert.equal(diff.statusCode, 500)
  })

  it('serves journey analytics and keys its cache by time range', async () => {
    const first = await app.inject({ method: 'GET', url: `${JOURNEY_URL}?startTs=100&endTs=300` })
    assert.equal(first.statusCode, 200)
    assert.equal(first.json().range.activeDays, 1)

    raw.close()

    const same = await app.inject({ method: 'GET', url: `${JOURNEY_URL}?startTs=100&endTs=300` })
    assert.equal(same.statusCode, 200)
    assert.deepEqual(same.json(), first.json())

    const differentRange = await app.inject({ method: 'GET', url: `${JOURNEY_URL}?startTs=200&endTs=300` })
    assert.equal(differentRange.statusCode, 500)
  })
})
