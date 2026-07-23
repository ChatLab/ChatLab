import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveAnnualActivityRhythm } from './annual-activity-rhythm'

test('returns empty activity rhythm when there are no sent messages', () => {
  assert.deepEqual(deriveAnnualActivityRhythm([]), {
    longestActiveStreak: 0,
    topWeekday: null,
    weekdayMessageRate: null,
    weekendMessageRate: null,
  })
})

test('derives a single active day and complementary weekday rates', () => {
  assert.deepEqual(deriveAnnualActivityRhythm([{ date: '2026-07-20', messageCount: 3 }]), {
    longestActiveStreak: 1,
    topWeekday: 1,
    weekdayMessageRate: 100,
    weekendMessageRate: 0,
  })
})

test('finds the longest streak across month and year boundaries regardless of input order', () => {
  const result = deriveAnnualActivityRhythm([
    { date: '2026-01-04', messageCount: 1 },
    { date: '2025-12-31', messageCount: 2 },
    { date: '2026-01-02', messageCount: 1 },
    { date: '2026-01-01', messageCount: 1 },
    { date: '2026-01-03', messageCount: 1 },
    { date: '2025-12-28', messageCount: 4 },
  ])

  assert.equal(result.longestActiveStreak, 5)
})

test('treats leap day as a consecutive calendar day', () => {
  const result = deriveAnnualActivityRhythm([
    { date: '2024-02-28', messageCount: 1 },
    { date: '2024-02-29', messageCount: 1 },
    { date: '2024-03-01', messageCount: 1 },
  ])

  assert.equal(result.longestActiveStreak, 3)
})

test('uses Monday-first order to break top-weekday ties', () => {
  const result = deriveAnnualActivityRhythm([
    { date: '2026-07-21', messageCount: 5 },
    { date: '2026-07-20', messageCount: 5 },
    { date: '2026-07-22', messageCount: 1 },
  ])

  assert.equal(result.topWeekday, 1)
})

test('computes weekday and weekend shares that always add up to 100', () => {
  const result = deriveAnnualActivityRhythm([
    { date: '2026-07-20', messageCount: 1 },
    { date: '2026-07-25', messageCount: 2 },
  ])

  assert.equal(result.weekdayMessageRate, 33)
  assert.equal(result.weekendMessageRate, 67)
  assert.equal(result.weekdayMessageRate! + result.weekendMessageRate!, 100)
})
