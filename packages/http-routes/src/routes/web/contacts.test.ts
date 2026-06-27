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
import type { ContactsService, DatabaseManager, SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'
import { registerContactsRoutes } from './contacts'

function emptyContactsResponse(status: ContactsResponse['cache']['status'] = 'missing'): ContactsResponse {
  return {
    contacts: [],
    diagnostics: {
      privateSessionCount: 0,
      contactsEnabled: false,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedInvalidPlatformIdMembers: 0,
      skippedFailedSessions: 0,
      hiddenLowSignalNonFriends: 0,
      warnings: [],
    },
    cache: {
      status,
      computedAt: null,
    },
    algorithmVersion: 'contacts-v1',
    task: {
      id: 'task-1',
      status: 'running',
      startedAt: 1000,
      finishedAt: null,
      processedSessions: 0,
      totalSessions: 1,
    },
  }
}

class FakeContactsService implements ContactsService {
  getCalls: Array<{ acceptStale?: boolean }> = []
  recomputeCalls = 0

  getContacts(options?: { acceptStale?: boolean }): ContactsResponse {
    this.getCalls.push({ acceptStale: options?.acceptStale })
    return emptyContactsResponse('missing')
  }

  startRecompute(): ContactsResponse {
    this.recomputeCalls++
    return emptyContactsResponse('stale')
  }

  invalidateContactsCache(): void {
    throw new Error('not used in route contract tests')
  }
}

function createMockContext(contactsService: ContactsService): HttpRouteContext {
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
    dbManager: {} as DatabaseManager,
    getVersion: () => 'test',
  } as HttpRouteContext
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
  assert.deepEqual(service.getCalls, [{ acceptStale: true }])
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
  assert.equal(service.recomputeCalls, 1)
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
