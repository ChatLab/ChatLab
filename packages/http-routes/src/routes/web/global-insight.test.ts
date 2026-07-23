import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type { AnnualSummaryResponse } from '@openchatlab/shared-types'
import type {
  GlobalInsightService,
  GlobalInsightServiceOptions,
  SessionRuntimeAdapter,
} from '@openchatlab/node-runtime'
import type { PathProvider } from '@openchatlab/core'
import { registerGlobalInsightRoutes } from './global-insight'

type GlobalInsightRouteContext = Parameters<typeof registerGlobalInsightRoutes>[1]

function emptyResponse(): AnnualSummaryResponse {
  return {
    range: { mode: 'year', year: 2026, startTs: 1, endTs: 2 },
    availableDataYears: [],
    latestDataYear: null,
    metrics: null,
    monthlyActivity: [],
    monthlyDirectContacts: [],
    dailyActivity: [],
    messageTypes: [],
    textLength: null,
    coverage: {
      totalSessions: 0,
      analyzedSessions: 0,
      missingOwnerSessions: 0,
      unresolvedOwnerSessions: 0,
      failedSessions: 0,
    },
    cache: { status: 'missing', computedAt: null },
    task: {
      id: null,
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      processedSessions: 0,
      totalSessions: 0,
    },
  }
}

class FakeService implements GlobalInsightService {
  getCalls: GlobalInsightServiceOptions[] = []
  recomputeCalls: GlobalInsightServiceOptions[] = []
  closeCalls = 0
  getAnnualSummary(options: GlobalInsightServiceOptions = {}) {
    this.getCalls.push(options)
    return emptyResponse()
  }
  startRecompute(options: GlobalInsightServiceOptions = {}) {
    this.recomputeCalls.push(options)
    return emptyResponse()
  }
  invalidateCache() {
    // Not used by route contract tests.
  }
  normalizeRange() {
    return emptyResponse().range
  }
  replaceSnapshotForTests() {
    // Not used by route contract tests.
  }
  async close() {
    this.closeCalls++
  }
}

function context(service: GlobalInsightService): GlobalInsightRouteContext {
  return {
    globalInsightService: service,
    sessionAdapter: {} as SessionRuntimeAdapter,
    pathProvider: {} as PathProvider,
  }
}

test('GET forwards year mode and stale preference', async (t) => {
  const service = new FakeService()
  const app = Fastify()
  t.after(() => app.close())
  registerGlobalInsightRoutes(app, context(service))
  await app.ready()

  const response = await app.inject({
    method: 'GET',
    url: '/_web/global-insight/annual-summary?mode=year&year=2024&acceptStale=1',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.getCalls, [{ mode: 'year', year: 2024, days: undefined, acceptStale: true }])
  assert.deepEqual(response.json().monthlyDirectContacts, [])
})

test('GET normalizes unsupported values before calling the service', async (t) => {
  const service = new FakeService()
  const app = Fastify()
  t.after(() => app.close())
  registerGlobalInsightRoutes(app, context(service))
  await app.ready()

  await app.inject({ method: 'GET', url: '/_web/global-insight/annual-summary?mode=other&year=nope&days=2' })

  assert.deepEqual(service.getCalls, [{ mode: 'year', year: undefined, days: undefined, acceptStale: false }])
})

test('POST recompute forwards recent mode and closes the injected service', async () => {
  const service = new FakeService()
  const app = Fastify()
  registerGlobalInsightRoutes(app, context(service))
  await app.ready()

  const response = await app.inject({
    method: 'POST',
    url: '/_web/global-insight/annual-summary/recompute?mode=recent&days=365',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.recomputeCalls, [{ mode: 'recent', year: undefined, days: 365 }])
  await app.close()
  assert.equal(service.closeCalls, 1)
})
