import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type { RestSessionProvider } from './session-provider'
import { registerRestSessionRoutes } from './sessions'
import { registerSystemRoutes } from './system'

const session = {
  id: 'worker-session',
  name: 'Worker Session',
  platform: 'wechat',
  type: 'group',
  groupId: 'group-1',
  messageCount: 2,
  memberCount: 1,
  firstTimestamp: 100,
  lastTimestamp: 200,
  lastPlatformMessageId: 'message-2',
  importedAt: 300,
}

function createAsyncProvider(): RestSessionProvider {
  return {
    countSessions: async () => 1,
    listSessions: async () => [session],
    getSession: async (sessionId) => (sessionId === session.id ? session : null),
    queryMessages: async (sessionId) =>
      sessionId === session.id
        ? {
            messages: [{ id: 1, content: 'hello' }],
            total: 2,
          }
        : null,
    getMembers: async (sessionId) => (sessionId === session.id ? [{ platformId: 'alice', aliases: ['Alice'] }] : null),
    getOverview: async (sessionId) =>
      sessionId === session.id
        ? {
            messageCount: 2,
            memberCount: 1,
            timeRange: { start: 100, end: 200 },
            messageTypeDistribution: { '0': 2 },
            topMembers: [{ platformId: 'alice', name: 'Alice', messageCount: 2, percentage: 100 }],
          }
        : null,
    executeReadonlySql: async (sessionId) => (sessionId === session.id ? { columns: ['count'], rows: [[2]] } : null),
    getExportData: async (sessionId) =>
      sessionId === session.id
        ? {
            members: [{ platformId: 'alice', accountName: 'Alice', aliases: ['A'] }],
            messages: [
              {
                senderPlatformId: 'alice',
                senderName: 'Alice',
                timestamp: 100,
                type: 0,
                content: 'hello',
              },
            ],
          }
        : null,
  }
}

test('REST routes share one contract with an async Worker-backed provider', async () => {
  const app = Fastify()
  const provider = createAsyncProvider()
  registerSystemRoutes(app, { getVersion: () => '0.31.2', countSessions: provider.countSessions })
  registerRestSessionRoutes(app, provider)
  await app.ready()

  const [status, sessions, detail, messages, members, overview, sql, exported] = await Promise.all([
    app.inject({ method: 'GET', url: '/api/v1/status' }),
    app.inject({ method: 'GET', url: '/api/v1/sessions' }),
    app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}` }),
    app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}/messages?limit=1` }),
    app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}/members` }),
    app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}/stats/overview` }),
    app.inject({ method: 'POST', url: `/api/v1/sessions/${session.id}/sql`, payload: { sql: 'SELECT 2' } }),
    app.inject({ method: 'GET', url: `/api/v1/sessions/${session.id}/export` }),
  ])

  assert.equal(status.json().data.sessionCount, 1)
  assert.deepEqual(sessions.json().data, [session])
  assert.deepEqual(detail.json().data, session)
  assert.equal(messages.json().data.totalPages, 2)
  assert.deepEqual(members.json().data[0].aliases, ['Alice'])
  assert.equal(overview.json().data.messageCount, 2)
  assert.deepEqual(sql.json().data.rows, [[2]])
  assert.deepEqual(exported.json().data.members[0].aliases, ['A'])
  assert.equal(exported.json().data.messages[0].sender, 'alice')

  const missingSql = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions/missing/sql',
    payload: { sql: 'SELECT 1' },
  })
  assert.equal(missingSql.statusCode, 404)
  assert.equal(missingSql.json().error.code, 'SESSION_NOT_FOUND')

  await app.close()
})
