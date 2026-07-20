import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getOverviewDurationDays,
  hasOverviewTimeFilter,
  resolveOverviewTimeRange,
  type OverviewTimeRange,
} from './overviewTimeRange'

const SECONDS_PER_DAY = 86400

describe('overviewTimeRange', () => {
  it('calculates recent 365-day ranges as 365 days', () => {
    assert.equal(getOverviewDurationDays({ start: 0, end: 365 * SECONDS_PER_DAY }), 365)
  })

  it('calculates custom calendar ranges by selected window', () => {
    const start = Date.UTC(2026, 5, 1, 0, 0, 0) / 1000
    const end = Date.UTC(2026, 5, 30, 23, 59, 59) / 1000

    assert.equal(getOverviewDurationDays({ start, end }), 30)
  })

  it('treats a single timestamp as a one-day range', () => {
    assert.equal(getOverviewDurationDays({ start: 1000, end: 1000 }), 1)
  })

  it('never reports fewer duration days than observed active calendar days', () => {
    const start = Date.UTC(2026, 6, 18, 16, 0, 0) / 1000
    const end = Date.UTC(2026, 6, 19, 16, 0, 0) / 1000

    assert.equal(getOverviewDurationDays({ start, end }, 2), 2)
  })

  it('returns 0 for empty or invalid ranges', () => {
    assert.equal(getOverviewDurationDays(null), 0)
    assert.equal(getOverviewDurationDays({ start: 2, end: 1 }), 0)
  })

  it('resolves the active filter before the full session range', () => {
    const fullRange: OverviewTimeRange = { start: 10, end: 100 }

    assert.deepEqual(resolveOverviewTimeRange(fullRange, { startTs: 40, endTs: 50 }), { start: 40, end: 50 })
    assert.deepEqual(resolveOverviewTimeRange(fullRange), fullRange)
  })

  it('detects complete time filters', () => {
    assert.equal(hasOverviewTimeFilter({ startTs: 1, endTs: 2 }), true)
    assert.equal(hasOverviewTimeFilter({ startTs: 1 }), false)
    assert.equal(hasOverviewTimeFilter(), false)
  })
})
