import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import type { SessionRuntimeAdapter } from '../adapters'
import { createTimeInvestmentService } from './time-investment-service'
import type { TimeInvestmentSnapshot } from './time-investment-types'
import type { TimeInvestmentComputeRunner } from './worker-runner'

test('starts one time investment task and exposes its persisted snapshot', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-time-investment-service-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'chat.db')
  fs.writeFileSync(dbPath, '')
  let now = new Date(2026, 5, 1).getTime()
  const adapter = {
    listSessionIds: () => ['chat-1'],
    getDbPath: () => dbPath,
  } as unknown as SessionRuntimeAdapter
  let runnerCalls = 0
  let excludedSessionIds: string[] = []
  const runnerExclusions: string[][] = []
  const runner: TimeInvestmentComputeRunner = async ({ signature, range: normalizedRange, excludedSessionIds }) => {
    runnerCalls++
    runnerExclusions.push([...excludedSessionIds])
    return snapshot(normalizedRange, signature)
  }
  const service = createTimeInvestmentService({
    adapter,
    userDataDir: dir,
    runner,
    getExcludedSessionIds: () => excludedSessionIds,
    now: () => now,
  })

  const first = service.getTimeInvestment({ mode: 'year', year: 2026 })
  const duplicate = service.getTimeInvestment({ mode: 'year', year: 2026 })
  assert.equal(first.task.status, 'running')
  assert.equal(duplicate.task.status, 'running')
  assert.equal(runnerCalls, 1)

  await new Promise((resolve) => setImmediate(resolve))
  now += 100
  const completed = service.getTimeInvestment({ mode: 'year', year: 2026 })
  assert.equal(completed.cache.status, 'fresh')
  assert.equal(completed.metrics?.estimatedSeconds, 300)
  assert.equal(completed.task.status, 'succeeded')

  excludedSessionIds = ['chat-1']
  const stale = service.getTimeInvestment({ mode: 'year', year: 2026, acceptStale: true })
  assert.equal(stale.cache.status, 'stale')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runnerCalls, 2)
  assert.deepEqual(runnerExclusions, [[], ['chat-1']])
  assert.equal(service.getTimeInvestment({ mode: 'year', year: 2026 }).cache.status, 'fresh')
  await service.close()
})

function snapshot(range: AnnualSummaryRange, signature: string): TimeInvestmentSnapshot {
  return {
    algorithmVersion: 'time-investment-v2',
    signature,
    computedAt: 150,
    range,
    availableDataYears: [2026],
    latestDataYear: 2026,
    metrics: {
      estimatedSeconds: 300,
      activeDayCount: 1,
      averagePerActiveDaySeconds: 300,
    },
    monthlyActivity: [],
    dailyActivity: [],
    sessionRanking: [],
    chatTypes: [],
    coverage: {
      totalSessions: 1,
      analyzedSessions: 1,
      missingOwnerSessions: 0,
      unresolvedOwnerSessions: 0,
      failedSessions: 0,
    },
    workerStats: {
      durationMs: 50,
      totalSessions: 1,
      processedSessions: 1,
      cacheHits: 0,
      cacheMisses: 1,
    },
  }
}
