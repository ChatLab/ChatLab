import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import type { SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import { registerSessionRoutes } from './sessions'

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

describe('CLI Web session routes', () => {
  it('returns 404 when requesting a missing session by id', async () => {
    const app = Fastify()
    registerSessionRoutes(app, createMissingSessionAdapter())

    const response = await app.inject({ method: 'GET', url: '/_web/sessions/missing' })
    await app.close()

    assert.equal(response.statusCode, 404)
  })
})
