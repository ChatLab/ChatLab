import assert from 'node:assert/strict'
import test from 'node:test'
import { getAnnualSummaryElapsedDayCount, normalizeAnnualSummaryRange, toAnnualSummaryRangeKey } from './time-range'

const now = new Date(2026, 6, 11, 12, 30, 0)

test('defaults to the current natural year and stops at now', () => {
  const range = normalizeAnnualSummaryRange({}, now)

  assert.equal(range.mode, 'year')
  assert.equal(range.year, 2026)
  assert.equal(new Date(range.startTs * 1000).toString(), new Date(2026, 0, 1, 0, 0, 0).toString())
  assert.equal(range.endTs, Math.floor(now.getTime() / 1000))
  assert.equal(getAnnualSummaryElapsedDayCount(range), 192)
  assert.equal(toAnnualSummaryRangeKey(range), 'year-2026')
})

test('uses a complete historical year including leap day', () => {
  const range = normalizeAnnualSummaryRange({ mode: 'year', year: 2024 }, now)

  assert.equal(new Date(range.endTs * 1000).toString(), new Date(2024, 11, 31, 23, 59, 59).toString())
  assert.equal(getAnnualSummaryElapsedDayCount(range), 366)
})

test('normalizes recent mode to today plus the previous 364 local days', () => {
  const range = normalizeAnnualSummaryRange({ mode: 'recent', days: 99 }, now)

  assert.deepEqual({ mode: range.mode, days: range.days }, { mode: 'recent', days: 365 })
  assert.equal(new Date(range.startTs * 1000).toString(), new Date(2025, 6, 12, 0, 0, 0).toString())
  assert.equal(range.endTs, Math.floor(now.getTime() / 1000))
  assert.equal(getAnnualSummaryElapsedDayCount(range), 365)
  assert.equal(toAnnualSummaryRangeKey(range), 'recent-365')
})

test('rejects future and implausible years by falling back to current year', () => {
  assert.equal(normalizeAnnualSummaryRange({ mode: 'year', year: 2027 }, now).year, 2026)
  assert.equal(normalizeAnnualSummaryRange({ mode: 'year', year: 1969 }, now).year, 2026)
})
