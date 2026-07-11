import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AnnualSummarySnapshot } from './types'
import {
  cleanupAnnualSummarySnapshotTempFiles,
  readAnnualSummarySnapshot,
  writeAnnualSummarySnapshot,
} from './snapshot'

const snapshot: AnnualSummarySnapshot = {
  algorithmVersion: 'v1',
  signature: 'sig',
  computedAt: 100,
  range: { mode: 'year', year: 2026, startTs: 1, endTs: 2 },
  availableDataYears: [],
  latestDataYear: null,
  metrics: {
    sentMessageCount: 0,
    activeDayCount: 0,
    directContactCount: 0,
    averageMessagesPerDay: 0,
    averageDirectContactsPerDay: 0,
  },
  monthlyActivity: [],
  dailyActivity: [],
  messageTypes: [],
  textLength: { textMessageCount: 0, median: null, p90: null, buckets: [] },
  coverage: {
    totalSessions: 0,
    analyzedSessions: 0,
    missingOwnerSessions: 0,
    unresolvedOwnerSessions: 0,
    failedSessions: 0,
  },
  workerStats: { durationMs: 1, totalSessions: 0, processedSessions: 0, cacheHits: 0, cacheMisses: 0 },
}

test('writes and reads a range-specific snapshot atomically', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-global-insight-snapshot-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  writeAnnualSummarySnapshot(dir, snapshot)

  assert.deepEqual(readAnnualSummarySnapshot(dir, snapshot.range), snapshot)
  assert.equal(
    fs.readdirSync(dir).some((name) => name.includes('.tmp-')),
    false
  )
})

test('backs up a corrupt snapshot and cleans orphan temp files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-global-insight-snapshot-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'annual-summary-year-2026.json'), '{broken')
  fs.writeFileSync(path.join(dir, 'annual-summary.tmp-old'), 'tmp')

  assert.equal(readAnnualSummarySnapshot(dir, snapshot.range, { now: () => 123 }), null)
  assert.ok(fs.existsSync(path.join(dir, 'annual-summary.corrupt-123.json')))
  cleanupAnnualSummarySnapshotTempFiles(dir)
  assert.equal(fs.existsSync(path.join(dir, 'annual-summary.tmp-old')), false)
})
