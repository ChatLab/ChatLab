import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTimeSelectSourceKey, normalizeAllowedModes, normalizeAllowedRecentDays } from './timeSelectOptions'

test('keeps all time select modes by default and filters configured modes in canonical order', () => {
  assert.deepEqual(normalizeAllowedModes(), ['recent', 'quarter', 'year', 'custom'])
  assert.deepEqual(normalizeAllowedModes(['year', 'recent', 'year']), ['recent', 'year'])
})

test('keeps supported recent periods and falls back to one year', () => {
  assert.deepEqual(normalizeAllowedRecentDays(), [365, 730, 1825, 0])
  assert.deepEqual(normalizeAllowedRecentDays([365, 99]), [365])
  assert.deepEqual(normalizeAllowedRecentDays([]), [365])
})

test('keeps the source key stable when an equivalent range source gets a new object identity', () => {
  const first = buildTimeSelectSourceKey(undefined, {
    availableYears: [2026, 2024],
    fullRange: { start: 1704038400, end: 1783742400 },
  })
  const second = buildTimeSelectSourceKey(undefined, {
    availableYears: [2026, 2024],
    fullRange: { start: 1704038400, end: 1783742400 },
  })

  assert.equal(first, second)
})
