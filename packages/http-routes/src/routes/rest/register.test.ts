import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import type { RestSessionProvider, RestSessionSummary } from './session-provider'
import { registerRestRoutes } from './register'

function createProvider(session: RestSessionSummary): RestSessionProvider {
  return {
    countSessions: () => 7,
    listSessions: () => [session],
    getSession: () => null,
    queryMessages: () => null,
    getMembers: () => null,
    getOverview: () => null,
    executeReadonlySql: () => null,
    getExportData: () => null,
  }
}

test('registerRestRoutes prefers the injected session provider', async (t) => {
  const session: RestSessionSummary = {
    id: 'worker-session',
    name: 'Worker Session',
    platform: 'wechat',
    type: 'private',
    messageCount: 2,
    memberCount: 2,
    firstTimestamp: 100,
    lastTimestamp: 200,
  }
  const app = Fastify()
  t.after(() => app.close())

  registerRestRoutes(app, {
    dbManager: {} as DatabaseManager,
    getVersion: () => '9.9.9-test',
    restSessionProvider: createProvider(session),
  })
  await app.ready()

  const status = await app.inject({ method: 'GET', url: '/api/v1/status' })
  assert.equal(status.statusCode, 200)
  assert.equal(status.json().data.version, '9.9.9-test')
  assert.equal(status.json().data.sessionCount, 7)

  const sessions = await app.inject({ method: 'GET', url: '/api/v1/sessions' })
  assert.equal(sessions.statusCode, 200)
  assert.deepEqual(sessions.json().data, [session])
})
