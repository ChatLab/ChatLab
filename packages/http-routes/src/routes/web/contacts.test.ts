/**
 * Contract tests for shared contacts routes.
 *
 * Run: pnpm test -- packages/http-routes/src/routes/web/contacts.test.ts
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type { ContactsResponse } from '@openchatlab/shared-types'
import type { ContactsService, SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import { registerContactsRoutes } from './contacts'

type ContactsRouteContext = Parameters<typeof registerContactsRoutes>[1]

function emptyContactsResponse(status: ContactsResponse['cache']['status'] = 'missing'): ContactsResponse {
  return {
    contacts: [],
    diagnostics: {
      privateSessionCount: 0,
      activePrivateSessionCount: 0,
      contactsEnabled: false,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedInvalidPlatformIdMembers: 0,
      skippedFailedSessions: 0,
      warnings: [],
    },
    cache: {
      status,
      computedAt: null,
    },
    timeRange: {
      preset: '1y',
      anchorTs: null,
      startTs: null,
    },
    algorithmVersion: 'contacts-v1',
    pagination: {
      page: 1,
      pageSize: 100,
      total: 0,
      hasMore: false,
    },
    stats: {
      friendsTotal: 0,
      nonFriendsTotal: 0,
    },
    task: {
      id: 'task-1',
      status: 'running',
      startedAt: 1000,
      finishedAt: null,
      processedSessions: 0,
      totalSessions: 1,
      timeRangePreset: '1y',
    },
  }
}

class FakeContactsService implements ContactsService {
  getCalls: Array<{ acceptStale?: boolean; timeRangePreset?: string }> = []
  recomputeCalls: Array<{ timeRangePreset?: string }> = []
  pageCalls: Array<{
    acceptStale?: boolean
    timeRangePreset?: string
    pool?: string
    page?: number
    pageSize?: number
    query?: string
  }> = []
  detailCalls: Array<{ key: string; acceptStale?: boolean; timeRangePreset?: string }> = []
  markFriendCalls: Array<{ key: string; timeRangePreset?: string }> = []
  unmarkFriendCalls: Array<{ key: string; timeRangePreset?: string }> = []
  closeCalls = 0

  getContacts(options?: { acceptStale?: boolean; timeRangePreset?: string }): ContactsResponse {
    this.getCalls.push({ acceptStale: options?.acceptStale, timeRangePreset: options?.timeRangePreset })
    return emptyContactsResponse('missing')
  }

  getContactsPage(options?: {
    acceptStale?: boolean
    timeRangePreset?: string
    pool?: string
    page?: number
    pageSize?: number
    query?: string
  }): ContactsResponse {
    this.pageCalls.push({
      acceptStale: options?.acceptStale,
      timeRangePreset: options?.timeRangePreset,
      pool: options?.pool,
      page: options?.page,
      pageSize: options?.pageSize,
      query: options?.query,
    })
    return {
      ...emptyContactsResponse('missing'),
      pagination: { page: options?.page ?? 1, pageSize: options?.pageSize ?? 100, total: 0, hasMore: false },
      stats: { friendsTotal: 0, nonFriendsTotal: 0 },
    } as any
  }

  getContactDetail(key: string, options?: { acceptStale?: boolean; timeRangePreset?: string }) {
    this.detailCalls.push({ key, acceptStale: options?.acceptStale, timeRangePreset: options?.timeRangePreset })
    return {
      contact: null,
      cache: emptyContactsResponse('missing').cache,
      timeRange: emptyContactsResponse('missing').timeRange,
      algorithmVersion: 'contacts-v1',
      task: emptyContactsResponse('missing').task,
    }
  }

  startRecompute(options?: { timeRangePreset?: string }): ContactsResponse {
    this.recomputeCalls.push({ timeRangePreset: options?.timeRangePreset })
    return emptyContactsResponse('stale')
  }

  markContactAsFriend(key: string, options?: { timeRangePreset?: string }): { success: boolean } {
    this.markFriendCalls.push({ key, timeRangePreset: options?.timeRangePreset })
    return { success: true }
  }

  unmarkContactAsFriend(key: string, options?: { timeRangePreset?: string }): { success: boolean } {
    this.unmarkFriendCalls.push({ key, timeRangePreset: options?.timeRangePreset })
    return { success: true }
  }

  invalidateContactsCache(): void {
    throw new Error('not used in route contract tests')
  }

  async close(): Promise<void> {
    this.closeCalls++
  }
}

function createMockContext(contactsService: ContactsService): ContactsRouteContext {
  const pathProvider: PathProvider = {
    getSystemDir: () => path.join('/tmp', 'chatlab-contacts-route-test'),
    getUserDataDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'data'),
    getDatabaseDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'data', 'databases'),
    getVectorDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'vector'),
    getAiDataDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'ai'),
    getSettingsDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'settings'),
    getCacheDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'cache'),
    getTempDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'temp'),
    getLogsDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'logs'),
    getDownloadsDir: () => path.join('/tmp', 'chatlab-contacts-route-test', 'downloads'),
  }
  const sessionAdapter = {
    listSessionIds: () => [],
  } as unknown as SessionRuntimeAdapter

  return {
    sessionAdapter,
    pathProvider,
    contactsService,
  }
}

test('GET /_web/contacts returns contacts response with task state', async (t) => {
  const service = new FakeContactsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({ method: 'GET', url: '/_web/contacts?acceptStale=1' })

  assert.equal(response.statusCode, 200)
  const body = response.json<ContactsResponse>()
  assert.equal(body.cache.status, 'missing')
  assert.equal(body.task?.status, 'running')
  assert.deepEqual(service.pageCalls, [
    {
      acceptStale: true,
      timeRangePreset: '1y',
      pool: undefined,
      page: undefined,
      pageSize: undefined,
      query: undefined,
    },
  ])
})

test('GET /_web/contacts forwards explicit time range preset', async (t) => {
  const service = new FakeContactsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({ method: 'GET', url: '/_web/contacts?acceptStale=1&timeRange=2y' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.pageCalls, [
    {
      acceptStale: true,
      timeRangePreset: '2y',
      pool: undefined,
      page: undefined,
      pageSize: undefined,
      query: undefined,
    },
  ])
})

test('GET /_web/contacts forwards pagination, pool, search, and time range query', async (t) => {
  const service = new FakeContactsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({
    method: 'GET',
    url: '/_web/contacts?acceptStale=1&timeRange=2y&pool=non_friend&page=2&pageSize=50&q=Alice',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.pageCalls, [
    {
      acceptStale: true,
      timeRangePreset: '2y',
      pool: 'non_friend',
      page: 2,
      pageSize: 50,
      query: 'Alice',
    },
  ])
  assert.deepEqual(service.getCalls, [])
})

test('GET /_web/contacts/:key/detail forwards decoded contact key and stale preference', async (t) => {
  const service = new FakeContactsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({
    method: 'GET',
    url: `/_web/contacts/${encodeURIComponent('weixin:alice')}/detail?acceptStale=1&timeRange=2y`,
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.detailCalls, [{ key: 'weixin:alice', acceptStale: true, timeRangePreset: '2y' }])
})

test('POST /_web/contacts/recompute starts or reuses background recompute without waiting for completion', async (t) => {
  const service = new FakeContactsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({ method: 'POST', url: '/_web/contacts/recompute' })

  assert.equal(response.statusCode, 200)
  const body = response.json<ContactsResponse>()
  assert.equal(body.cache.status, 'stale')
  assert.equal(body.task?.status, 'running')
  assert.deepEqual(service.recomputeCalls, [{ timeRangePreset: '1y' }])
})

test('override routes are not registered', async (t) => {
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(new FakeContactsService()))
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

test('PUT and DELETE /_web/contacts/:key/mark-friend forward decoded key and time range', async (t) => {
  const service = new FakeContactsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  const putResponse = await app.inject({
    method: 'PUT',
    url: `/_web/contacts/${encodeURIComponent('weixin:alice')}/mark-friend?timeRange=2y`,
  })
  assert.equal(putResponse.statusCode, 200)
  assert.deepEqual(putResponse.json(), { success: true })

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/_web/contacts/${encodeURIComponent('weixin:alice')}/mark-friend?timeRange=2y`,
  })
  assert.equal(deleteResponse.statusCode, 200)
  assert.deepEqual(deleteResponse.json(), { success: true })

  assert.deepEqual(service.markFriendCalls, [{ key: 'weixin:alice', timeRangePreset: '2y' }])
  assert.deepEqual(service.unmarkFriendCalls, [{ key: 'weixin:alice', timeRangePreset: '2y' }])
})

test('closes contacts service when Fastify app closes', async () => {
  const service = new FakeContactsService()
  const app = Fastify()
  registerContactsRoutes(app, createMockContext(service))
  await app.ready()

  await app.close()

  assert.equal(service.closeCalls, 1)
})
