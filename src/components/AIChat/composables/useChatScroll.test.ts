import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoalescedScrollScheduler } from './useChatScroll'

test('coalesces repeated scroll requests into one pending task', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: boolean[] = []
  const scheduler = createCoalescedScrollScheduler((force) => calls.push(force))

  scheduler.schedule()
  scheduler.schedule()
  scheduler.schedule()
  t.mock.timers.tick(100)

  assert.deepEqual(calls, [false])
})

test('preserves a force request when upgrading a pending scroll', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: boolean[] = []
  const scheduler = createCoalescedScrollScheduler((force) => calls.push(force))

  scheduler.schedule()
  scheduler.schedule(true)
  t.mock.timers.tick(100)

  assert.deepEqual(calls, [true])
})

test('cancels the pending scroll task', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: boolean[] = []
  const scheduler = createCoalescedScrollScheduler((force) => calls.push(force))

  scheduler.schedule(true)
  scheduler.cancel()
  t.mock.timers.tick(100)

  assert.deepEqual(calls, [])
})
