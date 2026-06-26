/**
 * Contract tests for shared contacts routes.
 *
 * Run: pnpm test -- packages/http-routes/src/routes/web/contacts.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import { CHAT_DB_SCHEMA } from '@openchatlab/core'
import type { PathProvider } from '@openchatlab/core'
import type { ContactsResponse } from '@openchatlab/shared-types'
import { openBetterSqliteDatabase } from '@openchatlab/node-runtime'
import type { DatabaseManager, SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'
import { registerContactsRoutes } from './contacts'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-routes-'))
}

class TestEnv {
  readonly dir = makeTempDir()
  private readonly dbPath = path.join(this.dir, 'private-a.db')

  seed(): void {
    const db = openBetterSqliteDatabase(this.dbPath, { nativeBinding })
    db.exec(CHAT_DB_SCHEMA)
    db.prepare(`INSERT INTO meta (name, platform, type, imported_at, owner_id) VALUES (?, ?, ?, ?, ?)`).run(
      'private-a',
      'weixin',
      'private',
      1780000000,
      'owner'
    )
    db.prepare(`INSERT INTO member (id, platform_id, account_name) VALUES (?, ?, ?), (?, ?, ?)`).run(
      1,
      'owner',
      'Me',
      2,
      'alice',
      'Alice'
    )
    for (let i = 0; i < 60; i++) {
      db.prepare(
        `INSERT INTO message (id, sender_id, ts, type, content, platform_message_id) VALUES (?, ?, ?, 0, ?, ?)`
      ).run(i + 1, i % 2 === 0 ? 1 : 2, 1704103200 + i, `message ${i + 1}`, `m-${i + 1}`)
    }
    db.close()
  }

  context(): HttpRouteContext {
    const pathProvider: PathProvider = {
      getSystemDir: () => this.dir,
      getUserDataDir: () => this.dir,
      getDatabaseDir: () => this.dir,
      getVectorDir: () => path.join(this.dir, 'vector'),
      getAiDataDir: () => path.join(this.dir, 'ai'),
      getSettingsDir: () => path.join(this.dir, 'settings'),
      getCacheDir: () => path.join(this.dir, 'cache'),
      getTempDir: () => path.join(this.dir, 'temp'),
      getLogsDir: () => path.join(this.dir, 'logs'),
      getDownloadsDir: () => path.join(this.dir, 'downloads'),
    }
    const open = (readonly: boolean) => openBetterSqliteDatabase(this.dbPath, { readonly, nativeBinding })
    const sessionAdapter: SessionRuntimeAdapter = {
      listSessionIds: () => ['private-a'],
      openReadonly: () => open(true),
      openWritable: () => open(false),
      closeSession: () => {},
      getDbPath: () => this.dbPath,
      deleteSessionFile: () => false,
      ensureReadonly: () => open(true),
      ensureWritable: () => open(false),
    }

    return {
      sessionAdapter,
      pathProvider,
      dbManager: {} as DatabaseManager,
      getVersion: () => 'test',
    } as HttpRouteContext
  }

  touchDb(): void {
    fs.utimesSync(this.dbPath, new Date(), new Date(Date.now() + 5000))
  }

  cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

test('contacts routes return contacts and recompute results', async (t) => {
  const env = new TestEnv()
  env.seed()
  t.after(() => env.cleanup())
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, env.context())
  await app.ready()

  const first = await app.inject({ method: 'GET', url: '/_web/contacts' })
  assert.equal(first.statusCode, 200)
  const firstBody = first.json<ContactsResponse>()
  assert.equal(firstBody.contacts[0].key, 'weixin:alice')
  assert.equal(firstBody.cache.status, 'fresh')

  const recomputed = await app.inject({ method: 'POST', url: '/_web/contacts/recompute' })
  assert.equal(recomputed.statusCode, 200)
  assert.equal(recomputed.json<ContactsResponse>().cache.status, 'fresh')
})

test('GET /_web/contacts supports acceptStale query', async (t) => {
  const env = new TestEnv()
  env.seed()
  t.after(() => env.cleanup())
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, env.context())
  await app.ready()

  const first = await app.inject({ method: 'GET', url: '/_web/contacts' })
  assert.equal(first.statusCode, 200)

  env.touchDb()
  const stale = await app.inject({ method: 'GET', url: '/_web/contacts?acceptStale=1' })
  assert.equal(stale.statusCode, 200)
  assert.equal(stale.json<ContactsResponse>().cache.status, 'stale')
})

test('override routes are not registered', async (t) => {
  const env = new TestEnv()
  env.seed()
  t.after(() => env.cleanup())
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, env.context())
  await app.ready()

  const patched = await app.inject({
    method: 'PATCH',
    url: '/_web/contacts/weixin:alice/override',
    payload: { isPinned: true },
  })
  assert.equal(patched.statusCode, 404)

  const deleted = await app.inject({
    method: 'DELETE',
    url: '/_web/contacts/weixin:alice/override',
  })
  assert.equal(deleted.statusCode, 404)
})
