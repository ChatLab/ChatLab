import assert from 'node:assert/strict'
import test from 'node:test'
import { InsightScopeController } from './insight-scope'

test('publishes normalized Insight snapshots without duplicate notifications', () => {
  const scope = new InsightScopeController()
  let notifications = 0
  const unsubscribe = scope.subscribe(() => notifications++)
  const snapshot = {
    time: {
      mode: 'year' as const,
      startTs: 1,
      endTs: 2,
      isFullRange: false,
      year: 2026,
    },
  }

  scope.updateSnapshot(snapshot)
  scope.updateSnapshot({ time: { ...snapshot.time } })
  assert.deepEqual(scope.getSnapshot(), snapshot)
  assert.equal(notifications, 1)

  unsubscribe()
  scope.updateSnapshot({})
  assert.equal(notifications, 1)
})

test('forwards allowed Insight time commands only while the host is attached', () => {
  const scope = new InsightScopeController()
  const events: Array<number | number[]> = []
  const detach = scope.attachTimeCommands({
    setAvailableYears: (years) => events.push(years),
    switchToYear: (year) => events.push(year),
  })

  scope.setAvailableTimeYears([2026, 2025])
  scope.switchTimeToYear(2025)
  assert.deepEqual(events, [[2026, 2025], 2025])

  detach()
  assert.throws(() => scope.switchTimeToYear(2024), /commands are unavailable/)
})
