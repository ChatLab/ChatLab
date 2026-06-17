/**
 * Smoke tests for registerSharedRoutes — verifies all route groups
 * are registered and respond correctly with mock context.
 *
 * Uses a single Fastify instance to avoid repeated NLP dict init overhead.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseAdapter, PathProvider, PreparedStatement, RunResult } from '@openchatlab/core'
import { PreferencesManager, type DatabaseManager, type SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../context'
import { registerSharedRoutes } from '../register'
import { registerRestSessionRoutes } from './sessions'
import { registerSessionRoutes } from './web/sessions'

class SqlitePreparedStatement implements PreparedStatement {
  readonly?: boolean

  constructor(private stmt: Database.Statement) {
    this.readonly = stmt.readonly
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...params) as Record<string, unknown> | undefined
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...params) as Record<string, unknown>[]
  }

  run(...params: unknown[]): RunResult {
    const result = this.stmt.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

class TestSqliteDb implements DatabaseAdapter {
  constructor(private db: Database.Database) {}

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): PreparedStatement {
    return new SqlitePreparedStatement(this.db.prepare(sql))
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  pragma(pragma: string): unknown {
    return this.db.pragma(pragma)
  }

  close(): void {
    this.db.close()
  }
}

function createSessionDb(): TestSqliteDb {
  const db = new TestSqliteDb(new Database(':memory:'))
  db.exec(`
    CREATE TABLE meta (
      name TEXT,
      platform TEXT,
      type TEXT,
      imported_at INTEGER,
      group_id TEXT,
      group_avatar TEXT,
      owner_id TEXT,
      session_gap_threshold INTEGER
    );
    CREATE TABLE member (
      id INTEGER PRIMARY KEY,
      platform_id TEXT,
      account_name TEXT,
      group_nickname TEXT,
      avatar TEXT
    );
    CREATE TABLE message (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER,
      ts INTEGER,
      type INTEGER,
      content TEXT,
      platform_message_id TEXT
    );
    CREATE TABLE segment (
      id INTEGER PRIMARY KEY,
      start_ts INTEGER,
      end_ts INTEGER,
      message_count INTEGER,
      is_manual INTEGER DEFAULT 0,
      summary TEXT
    );

    INSERT INTO meta (
      name, platform, type, imported_at, group_id, group_avatar, owner_id, session_gap_threshold
    ) VALUES ('Route Chat', 'wechat', 'group', 1700000000, 'group-1', NULL, 'alice', NULL);
    INSERT INTO member (id, platform_id, account_name, group_nickname, avatar) VALUES
      (1, 'alice', 'Alice', NULL, NULL),
      (2, 'bob', 'Bob', NULL, NULL);
    INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES
      (1, 1, 100, 0, 'alpha first', 'm-1'),
      (2, 2, 200, 0, 'alpha from bob', 'm-2'),
      (3, 1, 300, 0, 'alpha later', 'm-3');
  `)
  return db
}

function createTestContext(dbs: Map<string, DatabaseAdapter> = new Map()): HttpRouteContext {
  const pathProvider: PathProvider = {
    getSystemDir: () => '/tmp/chatlab-test',
    getUserDataDir: () => '/tmp/chatlab-test/data',
    getDatabaseDir: () => '/tmp/chatlab-test/databases',
    getVectorDir: () => '/tmp/chatlab-test/vector',
    getAiDataDir: () => '/tmp/chatlab-test/ai',
    getSettingsDir: () => '/tmp/chatlab-test/settings',
    getCacheDir: () => '/tmp/chatlab-test/cache',
    getTempDir: () => '/tmp/chatlab-test/temp',
    getLogsDir: () => '/tmp/chatlab-test/logs',
    getDownloadsDir: () => '/tmp/chatlab-test/downloads',
  }

  const dbManager = {
    listSessionIds: () => Array.from(dbs.keys()),
    open: (sessionId: string) => dbs.get(sessionId) ?? null,
    openWritable: (sessionId: string) => dbs.get(sessionId) ?? null,
    close: () => {},
    closeAll: () => {},
    getDbPath: (id: string) => `/tmp/${id}.db`,
  } as unknown as DatabaseManager

  const sessionAdapter: SessionRuntimeAdapter = {
    listSessionIds: () => Array.from(dbs.keys()),
    openReadonly: (sessionId) => dbs.get(sessionId) ?? null,
    openWritable: (sessionId) => dbs.get(sessionId) ?? null,
    closeSession: () => {},
    getDbPath: (id: string) => `/tmp/${id}.db`,
    deleteSessionFile: (sessionId) => dbs.delete(sessionId),
    ensureReadonly: (sessionId) => {
      const db = dbs.get(sessionId)
      if (!db) throw Object.assign(new Error('Session not found'), { statusCode: 404 })
      return db
    },
    ensureWritable: (sessionId) => {
      const db = dbs.get(sessionId)
      if (!db) throw Object.assign(new Error('Session not found'), { statusCode: 404 })
      return db
    },
  }

  return { dbManager, sessionAdapter, pathProvider, getVersion: () => '0.0.0-test' }
}

describe('registerSharedRoutes smoke tests', () => {
  let app: FastifyInstance

  before(async () => {
    app = Fastify()
    registerSharedRoutes(app, createTestContext())
    await app.ready()
  })

  after(async () => {
    await app.close()
  })

  it('GET /api/v1/status returns 200 with version', async () => {
    const resp = await app.inject({ method: 'GET', url: '/api/v1/status' })
    assert.equal(resp.statusCode, 200)
    const body = resp.json()
    assert.equal(body.data.version, '0.0.0-test')
    assert.equal(body.data.name, 'ChatLab API')
  })

  it('GET /api/v1/schema returns schema definition', async () => {
    const resp = await app.inject({ method: 'GET', url: '/api/v1/schema' })
    assert.equal(resp.statusCode, 200)
    const body = resp.json()
    assert.equal(body.data.format, 'ChatLab Format')
  })

  it('GET /api/v1/sessions returns empty list', async () => {
    const resp = await app.inject({ method: 'GET', url: '/api/v1/sessions' })
    assert.equal(resp.statusCode, 200)
    assert.deepEqual(resp.json().data, [])
  })

  it('GET /_web/sessions returns empty list', async () => {
    const resp = await app.inject({ method: 'GET', url: '/_web/sessions' })
    assert.equal(resp.statusCode, 200)
    assert.ok(Array.isArray(resp.json()))
  })

  it('GET /_web/sessions/:id returns 404 for missing session', async () => {
    const resp = await app.inject({ method: 'GET', url: '/_web/sessions/nonexistent' })
    assert.equal(resp.statusCode, 404)
  })

  it('GET /_web/nlp/pos-tags returns 200', async () => {
    const resp = await app.inject({ method: 'GET', url: '/_web/nlp/pos-tags' })
    assert.equal(resp.statusCode, 200)
  })

  it('GET /_web/preferences returns 200 or 500', async () => {
    const resp = await app.inject({ method: 'GET', url: '/_web/preferences' })
    assert.ok([200, 500].includes(resp.statusCode), `Expected 200 or 500, got ${resp.statusCode}`)
  })

  it('GET /api/v1/sessions/:id/messages applies query filters and pagination', async () => {
    const db = createSessionDb()
    const routeApp = Fastify()
    registerRestSessionRoutes(routeApp, createTestContext(new Map([['chat-1', db]])))
    await routeApp.ready()

    const resp = await routeApp.inject({
      method: 'GET',
      url: '/api/v1/sessions/chat-1/messages?keyword=alpha&senderId=1&startTime=100&endTime=250&limit=10',
    })

    await routeApp.close()
    db.close()

    assert.equal(resp.statusCode, 200)
    const body = resp.json()
    assert.equal(body.success, true)
    assert.equal(body.data.total, 1)
    assert.equal(body.data.messages.length, 1)
    assert.equal(body.data.messages[0].id, 1)
    assert.equal(body.data.messages[0].senderName, 'Alice')
    assert.equal(body.data.limit, 10)
  })

  it('POST /api/v1/sessions/:id/sql rejects write statements and keeps data unchanged', async () => {
    const db = createSessionDb()
    const routeApp = Fastify()
    registerRestSessionRoutes(routeApp, createTestContext(new Map([['chat-1', db]])))
    await routeApp.ready()

    const resp = await routeApp.inject({
      method: 'POST',
      url: '/api/v1/sessions/chat-1/sql',
      payload: { sql: 'DELETE FROM message' },
    })
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }

    await routeApp.close()
    db.close()

    assert.equal(resp.statusCode, 400)
    assert.equal(resp.json().error.code, 'SQL_READONLY_VIOLATION')
    assert.equal(countRow.count, 3)
  })

  it('PATCH /_web/sessions/:id/name updates the shared session metadata', async () => {
    const db = createSessionDb()
    const routeApp = Fastify()
    registerSessionRoutes(routeApp, createTestContext(new Map([['chat-1', db]])))
    await routeApp.ready()

    const resp = await routeApp.inject({
      method: 'PATCH',
      url: '/_web/sessions/chat-1/name',
      payload: { name: 'Renamed Chat' },
    })
    const meta = db.prepare('SELECT name FROM meta LIMIT 1').get() as { name: string }

    await routeApp.close()
    db.close()

    assert.equal(resp.statusCode, 200)
    assert.deepEqual(resp.json(), { success: true })
    assert.equal(meta.name, 'Renamed Chat')
  })

  it('DELETE /_web/sessions/:id delegates to the session adapter', async () => {
    const db = createSessionDb()
    const dbs = new Map<string, DatabaseAdapter>([['chat-1', db]])
    const routeApp = Fastify()
    registerSessionRoutes(routeApp, createTestContext(dbs))
    await routeApp.ready()

    const resp = await routeApp.inject({ method: 'DELETE', url: '/_web/sessions/chat-1' })

    await routeApp.close()
    db.close()

    assert.equal(resp.statusCode, 200)
    assert.deepEqual(resp.json(), { success: true })
    assert.equal(dbs.has('chat-1'), false)
  })

  it('owner profile routes select, apply and dismiss across sessions', async () => {
    const prefDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-owner-routes-'))
    const current = createSessionDb()
    current.exec(`UPDATE meta SET owner_id = NULL, platform = 'whatsapp'`)
    const other = createSessionDb()
    other.exec(`UPDATE meta SET owner_id = NULL, platform = 'whatsapp'`)
    const dismissedOnly = createSessionDb()
    dismissedOnly.exec(`UPDATE meta SET owner_id = NULL, platform = 'whatsapp'; DELETE FROM member`)

    const dbs = new Map<string, DatabaseAdapter>([
      ['chat-1', current],
      ['chat-2', other],
      ['chat-3', dismissedOnly],
    ])
    const ctx = createTestContext(dbs)
    ctx.preferencesManager = new PreferencesManager(prefDir)
    const routeApp = Fastify()
    registerSessionRoutes(routeApp, ctx)
    await routeApp.ready()

    try {
      // Dismiss the prompt for chat-3 (no matching member there)
      const dismissResp = await routeApp.inject({ method: 'POST', url: '/_web/sessions/chat-3/owner/dismiss-prompt' })
      assert.equal(dismissResp.statusCode, 200)
      assert.deepEqual(dismissResp.json(), { success: true })

      // apply-profile before any profile exists reports no_profile and the dismissed flag
      const earlyApply = await routeApp.inject({ method: 'POST', url: '/_web/sessions/chat-3/owner/apply-profile' })
      assert.equal(earlyApply.statusCode, 200)
      assert.deepEqual(earlyApply.json(), { applied: false, reason: 'no_profile', dismissed: true })

      // Manual selection writes owner, saves profile and batch-applies to chat-2
      const selectResp = await routeApp.inject({
        method: 'POST',
        url: '/_web/sessions/chat-1/owner/select',
        payload: { ownerPlatformId: 'alice' },
      })
      assert.equal(selectResp.statusCode, 200)
      const selectBody = selectResp.json()
      assert.equal(selectBody.ownerId, 'alice')
      assert.equal(selectBody.platform, 'whatsapp')
      assert.deepEqual(selectBody.updatedSessionIds, ['chat-2'])
      const currentMeta = current.prepare('SELECT owner_id FROM meta LIMIT 1').get() as { owner_id: string }
      const otherMeta = other.prepare('SELECT owner_id FROM meta LIMIT 1').get() as { owner_id: string }
      assert.equal(currentMeta.owner_id, 'alice')
      assert.equal(otherMeta.owner_id, 'alice')

      // apply-profile on an already-owned session reports already_set
      const applyResp = await routeApp.inject({ method: 'POST', url: '/_web/sessions/chat-2/owner/apply-profile' })
      assert.equal(applyResp.statusCode, 200)
      assert.deepEqual(applyResp.json(), { applied: false, ownerId: 'alice', reason: 'already_set', dismissed: false })
    } finally {
      await routeApp.close()
      current.close()
      other.close()
      dismissedOnly.close()
      fs.rmSync(prefDir, { recursive: true, force: true })
    }
  })
})
