import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type { AnnualSummaryResponse, TimeInvestmentResponse } from '@openchatlab/shared-types'
import type {
  GlobalInsightService,
  GlobalInsightServiceOptions,
  SessionRuntimeAdapter,
  TimeInvestmentService,
  TimeInvestmentServiceOptions,
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

function emptyTimeInvestmentResponse(): TimeInvestmentResponse {
  const annual = emptyResponse()
  return {
    range: annual.range,
    availableDataYears: [],
    latestDataYear: null,
    metrics: null,
    monthlyActivity: [],
    dailyActivity: [],
    sessionRanking: [],
    chatTypes: [],
    coverage: annual.coverage,
    cache: annual.cache,
    task: annual.task,
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

class FakeTimeInvestmentService implements TimeInvestmentService {
  getCalls: TimeInvestmentServiceOptions[] = []
  recomputeCalls: TimeInvestmentServiceOptions[] = []
  closeCalls = 0
  getTimeInvestment(options: TimeInvestmentServiceOptions = {}) {
    this.getCalls.push(options)
    return emptyTimeInvestmentResponse()
  }
  startRecompute(options: TimeInvestmentServiceOptions = {}) {
    this.recomputeCalls.push(options)
    return emptyTimeInvestmentResponse()
  }
  async close() {
    this.closeCalls++
  }
}

function context(
  service: GlobalInsightService,
  timeInvestmentService: TimeInvestmentService = new FakeTimeInvestmentService()
): GlobalInsightRouteContext {
  return {
    globalInsightService: service,
    timeInvestmentService,
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

test('time investment routes forward range, stale, and recompute options', async (t) => {
  const service = new FakeService()
  const timeInvestmentService = new FakeTimeInvestmentService()
  const app = Fastify()
  t.after(() => app.close())
  registerGlobalInsightRoutes(app, context(service, timeInvestmentService))
  await app.ready()

  const getResponse = await app.inject({
    method: 'GET',
    url: '/_web/global-insight/time-investment?mode=year&year=2025&acceptStale=true',
  })
  const recomputeResponse = await app.inject({
    method: 'POST',
    url: '/_web/global-insight/time-investment/recompute?mode=recent&days=365',
  })

  assert.equal(getResponse.statusCode, 200)
  assert.equal(recomputeResponse.statusCode, 200)
  assert.deepEqual(timeInvestmentService.getCalls, [{ mode: 'year', year: 2025, days: undefined, acceptStale: true }])
  assert.deepEqual(timeInvestmentService.recomputeCalls, [{ mode: 'recent', year: undefined, days: 365 }])
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
  const timeInvestmentService = new FakeTimeInvestmentService()
  const app = Fastify()
  registerGlobalInsightRoutes(app, context(service, timeInvestmentService))
  await app.ready()

  const response = await app.inject({
    method: 'POST',
    url: '/_web/global-insight/annual-summary/recompute?mode=recent&days=365',
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(service.recomputeCalls, [{ mode: 'recent', year: undefined, days: 365 }])
  await app.close()
  assert.equal(service.closeCalls, 1)
  assert.equal(timeInvestmentService.closeCalls, 1)
})
