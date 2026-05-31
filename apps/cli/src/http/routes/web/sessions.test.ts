import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import type { SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '@openchatlab/http-routes'
import { registerSessionRoutes } from '@openchatlab/http-routes'

function createMissingSessionAdapter(): SessionRuntimeAdapter {
  return {
    listSessionIds: () => [],
    openReadonly: () => null,
    openWritable: () => null,
    closeSession: () => {},
    getDbPath: (sessionId) => `/tmp/${sessionId}.db`,
    deleteSessionFile: () => false,
    ensureReadonly: () => {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 })
    },
    ensureWritable: () => {
      throw Object.assign(new Error('Session not found'), { statusCode: 404 })
    },
  }
}

function createMockContext(adapter: SessionRuntimeAdapter): HttpRouteContext {
  return {
    dbManager: {} as any,
    sessionAdapter: adapter,
    pathProvider: {} as any,
    getVersion: () => '0.0.0-test',
  }
}

describe('shared session routes', () => {
  it('returns 404 when requesting a missing session by id', async () => {
    const app = Fastify()
    const ctx = createMockContext(createMissingSessionAdapter())
    registerSessionRoutes(app, ctx)

    const response = await app.inject({ method: 'GET', url: '/_web/sessions/missing' })
    await app.close()

    assert.equal(response.statusCode, 404)
  })
})
