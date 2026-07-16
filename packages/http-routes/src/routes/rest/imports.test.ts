import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import { DatabaseManager } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'
import { registerImportRoutes } from './imports'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-import-route-'))
}

function createContext(rootDir: string): HttpRouteContext {
  const pathProvider: PathProvider = {
    getSystemDir: () => rootDir,
    getUserDataDir: () => rootDir,
    getDatabaseDir: () => path.join(rootDir, 'databases'),
    getVectorDir: () => path.join(rootDir, 'vector'),
    getAiDataDir: () => path.join(rootDir, 'ai'),
    getSettingsDir: () => path.join(rootDir, 'settings'),
    getCacheDir: () => path.join(rootDir, 'cache'),
    getTempDir: () => path.join(rootDir, 'temp'),
    getLogsDir: () => path.join(rootDir, 'logs'),
    getDownloadsDir: () => rootDir,
  }
  const dbManager = new DatabaseManager(pathProvider, { nativeBinding, allowMissingRuntimeForTests: true })

  return {
    dbManager,
    pathProvider,
    getVersion: () => '0.0.0-test',
  } as HttpRouteContext
}

function createPayload(content: string) {
  return {
    chatlab: { version: '0.0.2', exportedAt: 1780330900 },
    meta: { name: 'Route Import', platform: 'wechat', type: 'private' },
    members: [{ platformId: 'wxid_alice', accountName: 'Alice' }],
    messages: [
      {
        platformMessageId: `msg-${content}`,
        sender: 'wxid_alice',
        timestamp: 1780330832,
        type: 0,
        content,
      },
    ],
  }
}

test('replays the cached response for the same Idempotency-Key and body', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = Fastify()
  registerImportRoutes(app, createContext(root))
  await app.ready()
  t.after(() => app.close())

  const request = {
    method: 'POST' as const,
    url: '/api/v1/imports/idempotent-session',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-1' },
    payload: createPayload('hello'),
  }
  const first = await app.inject(request)
  const replay = await app.inject(request)

  assert.equal(first.statusCode, 200)
  assert.equal(replay.statusCode, 200)
  assert.deepEqual(replay.json(), first.json())

  const db = createContext(root).dbManager.openRawSessionDatabase('idempotent-session', { readonly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM message').get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
  }
})

test('rejects reuse of an Idempotency-Key with a different body', async (t) => {
  const root = makeTempDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = Fastify()
  registerImportRoutes(app, createContext(root))
  await app.ready()
  t.after(() => app.close())

  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/idempotency-conflict',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-1' },
    payload: createPayload('first'),
  })
  const conflict = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/idempotency-conflict',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-1' },
    payload: createPayload('second'),
  })

  assert.equal(first.statusCode, 200)
  assert.equal(conflict.statusCode, 409)
  assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(fs.existsSync(path.join(root, 'databases', 'idempotency-conflict.db')), true)
  assert.equal(fs.existsSync(path.join(root, 'idempotency-conflict.db')), false)
})
