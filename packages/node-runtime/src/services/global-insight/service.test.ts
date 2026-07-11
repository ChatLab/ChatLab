import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import type { SessionRuntimeAdapter } from '../adapters'
import { createGlobalInsightService } from './service'
import type { AnnualSummarySnapshot } from './types'
import type { AnnualSummaryComputeRunner } from './worker-runner'

function makeSnapshot(range: AnnualSummaryRange, signature: string, count = 3): AnnualSummarySnapshot {
  return {
    algorithmVersion: 'annual-summary-v1',
    signature,
    computedAt: 100,
    range,
    availableDataYears: [2026],
    latestDataYear: 2026,
    metrics: {
      sentMessageCount: count,
      activeDayCount: 1,
      directContactCount: 1,
      averageMessagesPerDay: count,
      averageDirectContactsPerDay: 1,
    },
    monthlyActivity: [],
    dailyActivity: [],
    messageTypes: [],
    textLength: { textMessageCount: 0, median: null, p90: null, buckets: [] },
    coverage: {
      totalSessions: 1,
      analyzedSessions: 1,
      missingOwnerSessions: 0,
      unresolvedOwnerSessions: 0,
      failedSessions: 0,
    },
    workerStats: { durationMs: 1, totalSessions: 1, processedSessions: 1, cacheHits: 0, cacheMisses: 1 },
  }
}

function createEnv(runner: AnnualSummaryComputeRunner) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-global-insight-service-'))
  const dbPath = path.join(dir, 'chat.db')
  fs.writeFileSync(dbPath, 'db')
  const adapter = {
    listSessionIds: () => ['chat-1'],
    getDbPath: () => dbPath,
  } as unknown as SessionRuntimeAdapter
  const service = createGlobalInsightService({ adapter, userDataDir: dir, runner, now: () => Date.UTC(2026, 0, 2) })
  return { dir, dbPath, adapter, service }
}

async function flushTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('starts one background task on a missing snapshot and then serves it fresh', async (t) => {
  let calls = 0
  const env = createEnv(async ({ signature, range }) => {
    calls++
    return makeSnapshot(range, signature)
  })
  t.after(async () => {
    await env.service.close()
    fs.rmSync(env.dir, { recursive: true, force: true })
  })

  const first = env.service.getAnnualSummary({ mode: 'year', year: 2026 })
  const duplicate = env.service.getAnnualSummary({ mode: 'year', year: 2026 })
  assert.equal(first.cache.status, 'missing')
  assert.equal(first.metrics, null)
  assert.equal(duplicate.task.status, 'running')
  assert.equal(calls, 1)

  await flushTasks()
  const fresh = env.service.getAnnualSummary({ mode: 'year', year: 2026 })
  assert.equal(fresh.cache.status, 'fresh')
  assert.equal(fresh.metrics?.sentMessageCount, 3)
})

test('serves stale data while recomputing after the DB signature changes', async (t) => {
  let resolveRunner: ((snapshot: AnnualSummarySnapshot) => void) | undefined
  const runner: AnnualSummaryComputeRunner = ({ signature, range }) =>
    new Promise((resolve) => {
      resolveRunner = () => resolve(makeSnapshot(range, signature, 9))
    })
  const env = createEnv(runner)
  t.after(async () => {
    await env.service.close()
    fs.rmSync(env.dir, { recursive: true, force: true })
  })
  const range = env.service.normalizeRange({ mode: 'year', year: 2026 })
  env.service.replaceSnapshotForTests(makeSnapshot(range, 'old-signature'))

  const stale = env.service.getAnnualSummary({ mode: 'year', year: 2026, acceptStale: true })
  assert.equal(stale.cache.status, 'stale')
  assert.equal(stale.metrics?.sentMessageCount, 3)
  assert.equal(stale.task.status, 'running')

  resolveRunner?.(makeSnapshot(range, stale.cache.signature ?? '', 9))
})

test('preserves failed state until explicit recompute', async (t) => {
  let calls = 0
  const env = createEnv(async ({ signature, range }) => {
    calls++
    if (calls === 1) throw new Error('worker failed')
    return makeSnapshot(range, signature)
  })
  t.after(async () => {
    await env.service.close()
    fs.rmSync(env.dir, { recursive: true, force: true })
  })

  env.service.getAnnualSummary({ mode: 'year', year: 2026 })
  await flushTasks()
  assert.equal(env.service.getAnnualSummary({ mode: 'year', year: 2026 }).task.status, 'failed')
  assert.equal(calls, 1)

  env.service.startRecompute({ mode: 'year', year: 2026 })
  await flushTasks()
  assert.equal(calls, 2)
  assert.equal(env.service.getAnnualSummary({ mode: 'year', year: 2026 }).cache.status, 'fresh')
})

test('discards a worker result when the DB signature changes during compute', async (t) => {
  let finish: (() => void) | undefined
  const env = createEnv(
    ({ signature, range }) =>
      new Promise((resolve) => {
        finish = () => resolve(makeSnapshot(range, signature))
      })
  )
  t.after(async () => {
    await env.service.close()
    fs.rmSync(env.dir, { recursive: true, force: true })
  })
  env.service.getAnnualSummary({ mode: 'year', year: 2026 })
  fs.appendFileSync(env.dbPath, 'changed')
  finish?.()
  await flushTasks()

  const response = env.service.getAnnualSummary({ mode: 'year', year: 2026 })
  assert.equal(response.cache.status, 'missing')
  assert.equal(response.task.status, 'running')
})

test('close aborts an in-flight task', async (t) => {
  let aborted = false
  const env = createEnv(
    ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
  )
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }))
  env.service.getAnnualSummary({ mode: 'year', year: 2026 })

  await env.service.close()

  assert.equal(aborted, true)
})
