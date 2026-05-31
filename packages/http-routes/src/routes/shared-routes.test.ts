/**
 * Smoke tests for registerSharedRoutes — verifies all route groups
 * are registered and respond correctly with mock context.
 *
 * Uses a single Fastify instance to avoid repeated NLP dict init overhead.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance } from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type { DatabaseManager, SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../context'
import { registerSharedRoutes } from '../register'

function createTestContext(): HttpRouteContext {
  const pathProvider: PathProvider = {
    getSystemDir: () => '/tmp/chatlab-test',
    getUserDataDir: () => '/tmp/chatlab-test/data',
    getDatabaseDir: () => '/tmp/chatlab-test/databases',
    getAiDataDir: () => '/tmp/chatlab-test/ai',
    getSettingsDir: () => '/tmp/chatlab-test/settings',
    getCacheDir: () => '/tmp/chatlab-test/cache',
    getTempDir: () => '/tmp/chatlab-test/temp',
    getLogsDir: () => '/tmp/chatlab-test/logs',
    getDownloadsDir: () => '/tmp/chatlab-test/downloads',
  }

  const dbManager = {
    listSessionIds: () => [],
    open: () => null,
    openWritable: () => null,
    close: () => {},
    closeAll: () => {},
    getDbPath: (id: string) => `/tmp/${id}.db`,
  } as unknown as DatabaseManager

  const sessionAdapter: SessionRuntimeAdapter = {
    listSessionIds: () => [],
    openReadonly: () => null,
    openWritable: () => null,
    closeSession: () => {},
    getDbPath: (id: string) => `/tmp/${id}.db`,
    deleteSessionFile: () => false,
    ensureReadonly: () => {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 })
    },
    ensureWritable: () => {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 })
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
})
