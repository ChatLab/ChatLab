/**
 * Contract tests for shared People relationships routes.
 *
 * Run: pnpm test -- packages/http-routes/src/routes/web/people-relationships.test.ts
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type {
  PeopleRelationshipsGraphResponse,
  PeopleRelationshipsNeighborhoodResponse,
} from '@openchatlab/shared-types'
import type { PeopleRelationshipsService, SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import { registerPeopleRelationshipsRoutes } from './people-relationships'

type PeopleRelationshipsRouteContext = Parameters<typeof registerPeopleRelationshipsRoutes>[1]

function emptyGraphResponse(
  status: PeopleRelationshipsGraphResponse['cache']['status'] = 'missing'
): PeopleRelationshipsGraphResponse {
  return {
    graph: { nodes: [], edges: [], communities: [] },
    searchResults: [],
    diagnostics: {
      processedPrivateSessions: 0,
      processedGroupSessions: 0,
      skippedMissingOwnerSessions: 0,
      skippedUnresolvedOwnerSessions: 0,
      skippedAmbiguousPrivateSessions: 0,
      skippedFailedSessions: 0,
      totalNodes: 0,
      totalEdges: 0,
      panoramaIncludedGroupSessions: 0,
      panoramaExcludedLowValueGroupSessions: 0,
      panoramaIncludedGroupMembers: 0,
      panoramaExcludedGroupMembers: 0,
      panoramaCandidateNodes: 0,
      panoramaGroupInclusionReasons: {},
      coreNodeCount: 0,
      coreEdgeCount: 0,
      warnings: [],
    },
    cache: { status, computedAt: null },
    timeRange: { preset: '1y', anchorTs: null, startTs: null },
    algorithmVersion: 'people-relationships-v1',
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

function emptyNeighborhoodResponse(
  status: PeopleRelationshipsGraphResponse['cache']['status'] = 'missing'
): PeopleRelationshipsNeighborhoodResponse {
  return {
    contact: null,
    graph: { nodes: [], edges: [], communities: [] },
    diagnostics: emptyGraphResponse(status).diagnostics,
    cache: { status, computedAt: null },
    timeRange: { preset: '1y', anchorTs: null, startTs: null },
    algorithmVersion: 'people-relationships-v1',
    task: emptyGraphResponse(status).task,
  }
}

class FakePeopleRelationshipsService implements PeopleRelationshipsService {
  graphCalls: Array<{ acceptStale?: boolean; timeRangePreset?: string; query?: string; graphScope?: string }> = []
  recomputeCalls: Array<{ timeRangePreset?: string; query?: string; graphScope?: string }> = []
  neighborhoodCalls: Array<{ key: string; acceptStale?: boolean; timeRangePreset?: string }> = []
  closeCalls = 0

  getGraph(options?: {
    acceptStale?: boolean
    timeRangePreset?: string
    query?: string
    graphScope?: string
  }): PeopleRelationshipsGraphResponse {
    this.graphCalls.push({
      acceptStale: options?.acceptStale,
      timeRangePreset: options?.timeRangePreset,
      query: options?.query,
      graphScope: options?.graphScope,
    })
    return emptyGraphResponse('missing')
  }

  getNeighborhood(
    key: string,
    options?: { acceptStale?: boolean; timeRangePreset?: string }
  ): PeopleRelationshipsNeighborhoodResponse {
    this.neighborhoodCalls.push({ key, acceptStale: options?.acceptStale, timeRangePreset: options?.timeRangePreset })
    return emptyNeighborhoodResponse('missing')
  }

  startRecompute(options?: {
    timeRangePreset?: string
    query?: string
    graphScope?: string
  }): PeopleRelationshipsGraphResponse {
    this.recomputeCalls.push({
      timeRangePreset: options?.timeRangePreset,
      query: options?.query,
      graphScope: options?.graphScope,
    })
    return emptyGraphResponse('stale')
  }

  invalidateRelationshipsCache(): void {
    throw new Error('not used in route contract tests')
  }

  async close(): Promise<void> {
    this.closeCalls++
  }
}

function createMockContext(relationshipsService: PeopleRelationshipsService): PeopleRelationshipsRouteContext {
  const pathProvider: PathProvider = {
    getSystemDir: () => path.join('/tmp', 'chatlab-relationships-route-test'),
    getUserDataDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'data'),
    getDatabaseDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'data', 'databases'),
    getVectorDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'vector'),
    getAiDataDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'ai'),
    getSettingsDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'settings'),
    getCacheDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'cache'),
    getTempDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'temp'),
    getLogsDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'logs'),
    getDownloadsDir: () => path.join('/tmp', 'chatlab-relationships-route-test', 'downloads'),
  }
  const sessionAdapter = {
    listSessionIds: () => [],
  } as unknown as SessionRuntimeAdapter

  return {
    sessionAdapter,
    pathProvider,
    peopleRelationshipsService: relationshipsService,
  }
}

test('GET /_web/people/relationships forwards stale, time range, search query, and graph scope', async (t) => {
  const service = new FakePeopleRelationshipsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerPeopleRelationshipsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({
    method: 'GET',
    url: '/_web/people/relationships?acceptStale=1&timeRange=2y&q=Alice&scope=close',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.graphCalls, [
    { acceptStale: true, timeRangePreset: '2y', query: 'Alice', graphScope: 'close' },
  ])
})

test('GET /_web/people/relationships forwards friends graph scope', async (t) => {
  const service = new FakePeopleRelationshipsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerPeopleRelationshipsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({
    method: 'GET',
    url: '/_web/people/relationships?scope=friends',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.graphCalls, [
    { acceptStale: false, timeRangePreset: '1y', query: undefined, graphScope: 'friends' },
  ])
})

test('POST /_web/people/relationships/recompute forwards time range, search query, and graph scope', async (t) => {
  const service = new FakePeopleRelationshipsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerPeopleRelationshipsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({
    method: 'POST',
    url: '/_web/people/relationships/recompute?timeRange=3y&q=Bob&scope=close',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.recomputeCalls, [{ timeRangePreset: '3y', query: 'Bob', graphScope: 'close' }])
})

test('GET /_web/people/relationships/:key/neighborhood forwards decoded contact key', async (t) => {
  const service = new FakePeopleRelationshipsService()
  const app = Fastify()
  t.after(async () => app.close())
  registerPeopleRelationshipsRoutes(app, createMockContext(service))
  await app.ready()

  const response = await app.inject({
    method: 'GET',
    url: `/_web/people/relationships/${encodeURIComponent('weixin:alice')}/neighborhood?acceptStale=1&timeRange=5y`,
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.neighborhoodCalls, [{ key: 'weixin:alice', acceptStale: true, timeRangePreset: '5y' }])
})

test('closes people relationships service when Fastify app closes', async () => {
  const service = new FakePeopleRelationshipsService()
  const app = Fastify()
  registerPeopleRelationshipsRoutes(app, createMockContext(service))
  await app.ready()

  await app.close()

  assert.equal(service.closeCalls, 1)
})
