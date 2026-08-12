import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import type {
  SessionRuntimeAdapter,
  TimeInvestmentService,
  TimeInvestmentServiceOptions,
} from '@openchatlab/node-runtime'
import type { TimeInvestmentResponse } from '@openchatlab/shared-types'
import type { PathProvider } from '@openchatlab/core'
import { registerNodePlugins, type NodePluginContext } from '../../node'
import { timeInvestmentNodePlugin } from '.'

function emptyTimeInvestmentResponse(): TimeInvestmentResponse {
  return {
    range: { mode: 'year', year: 2026, startTs: 1, endTs: 2 },
    availableDataYears: [],
    latestDataYear: null,
    metrics: null,
    monthlyActivity: [],
    dailyActivity: [],
    sessionRanking: [],
    chatTypes: [],
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

function context(service: TimeInvestmentService): NodePluginContext {
  return {
    timeInvestmentService: service,
    sessionAdapter: {} as SessionRuntimeAdapter,
    pathProvider: {} as PathProvider,
  }
}

test('time investment plugin forwards range, stale, recompute, and owns its service lifecycle', async () => {
  const timeInvestmentService = new FakeTimeInvestmentService()
  const app = Fastify()
  registerNodePlugins(app, context(timeInvestmentService), [timeInvestmentNodePlugin])
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
  await app.close()
  assert.equal(timeInvestmentService.closeCalls, 1)
})

test('omitting the time investment plugin leaves its API unavailable', async (t) => {
  const service = new FakeTimeInvestmentService()
  const app = Fastify()
  t.after(() => app.close())
  registerNodePlugins(app, context(service), [])
  await app.ready()

  const response = await app.inject({ method: 'GET', url: '/_web/global-insight/time-investment' })

  assert.equal(response.statusCode, 404)
  assert.equal(service.getCalls.length, 0)
  assert.equal(service.closeCalls, 0)
})
