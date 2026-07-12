import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AnnualSummaryRange } from '@openchatlab/shared-types'
import type { AnnualSummarySessionFacts } from '@openchatlab/core'
import {
  buildAnnualSummaryFactsCacheKey,
  readCachedAnnualSummarySessionFacts,
  writeCachedAnnualSummarySessionFacts,
} from './facts-cache'

const yearRange: AnnualSummaryRange = { mode: 'year', year: 2026, startTs: 1, endTs: 2 }
const recentRange: AnnualSummaryRange = { mode: 'recent', days: 365, startTs: 3, endTs: 4 }
const facts: AnnualSummarySessionFacts = {
  kind: 'analyzed',
  availableDataYears: [2026],
  ownerMessagesByDay: { '2026-01-01': 1 },
  directContactKeysByDay: {},
  messageTypeCounts: { '0': 1 },
  textLengthCounts: { '2': 1 },
}

test('keys isolate algorithm and range modes without accumulating current-year seconds', () => {
  assert.equal(buildAnnualSummaryFactsCacheKey('v1', yearRange), 'global-insight:facts:v1:v1:year-2026')
  assert.equal(buildAnnualSummaryFactsCacheKey('v2', yearRange), 'global-insight:facts:v1:v2:year-2026')
  assert.equal(buildAnnualSummaryFactsCacheKey('v1', recentRange), 'global-insight:facts:v1:v1:recent-365')
})

test('reads only matching DB versions and rolling range dates', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-global-insight-facts-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const key = buildAnnualSummaryFactsCacheKey('v1', recentRange)

  writeCachedAnnualSummarySessionFacts('chat-1', dir, key, 'db-v1', recentRange, facts)

  assert.equal(readCachedAnnualSummarySessionFacts('chat-1', dir, key, 'db-v1', recentRange).hit, true)
  assert.equal(readCachedAnnualSummarySessionFacts('chat-1', dir, key, 'db-v2', recentRange).hit, false)
  assert.equal(
    readCachedAnnualSummarySessionFacts('chat-1', dir, key, 'db-v1', { ...recentRange, startTs: 86_403 }).hit,
    false
  )
})
