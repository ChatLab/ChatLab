import assert from 'node:assert/strict'
import test from 'node:test'
import type { TimeRangeValue } from '@/components/common/TimeSelect.vue'
import { getInsightTimeFilterSignature, resolveInsightTimeInitialState } from './insight-time-range'

const sharedYearFilter = {
  defaultMode: 'year' as const,
  allowedModes: ['recent', 'year'] as const,
  allowedRecentDays: [365] as const,
}

const selected2024: TimeRangeValue = {
  startTs: 1,
  endTs: 2,
  displayLabel: '2024',
  isFullRange: false,
  state: { mode: 'year', year: 2024 },
}

test('keeps the shared time selection when Insight pages use the same filter contract', () => {
  const annualKey = getInsightTimeFilterSignature(sharedYearFilter)
  const timeInvestmentKey = getInsightTimeFilterSignature({ ...sharedYearFilter })

  assert.equal(annualKey, timeInvestmentKey)
  assert.deepEqual(resolveInsightTimeInitialState(selected2024, 'year', sharedYearFilter.allowedModes, 2026), {
    mode: 'year',
    year: 2024,
  })
})

test('restores the shared time selection after visiting a page without a time filter', () => {
  assert.deepEqual(resolveInsightTimeInitialState(selected2024, 'year', sharedYearFilter.allowedModes, 2026), {
    mode: 'year',
    year: 2024,
  })
})

test('falls back to the declared default when the previous mode is incompatible', () => {
  assert.deepEqual(resolveInsightTimeInitialState(selected2024, 'recent', ['recent'], 2026), {
    mode: 'recent',
    year: 2026,
  })
})
