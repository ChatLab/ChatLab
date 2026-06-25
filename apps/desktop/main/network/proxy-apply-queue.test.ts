import assert from 'node:assert/strict'
import test from 'node:test'
import { ProxyApplyQueue } from './proxy-apply-queue'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

test('ProxyApplyQueue waits for the pending apply before resolving waiters', async () => {
  const queue = new ProxyApplyQueue()
  const first = deferred()
  const events: string[] = []

  const applyPromise = queue.apply(async () => {
    events.push('apply:start')
    await first.promise
    events.push('apply:end')
  })

  const waitPromise = queue.waitForPending().then(() => {
    events.push('wait:end')
  })

  await nextTick()
  assert.deepEqual(events, ['apply:start'])

  first.resolve()
  await Promise.all([applyPromise, waitPromise])

  assert.deepEqual(events, ['apply:start', 'apply:end', 'wait:end'])
})

test('ProxyApplyQueue serializes overlapping apply calls', async () => {
  const queue = new ProxyApplyQueue()
  const first = deferred()
  const events: string[] = []

  const firstApply = queue.apply(async () => {
    events.push('first:start')
    await first.promise
    events.push('first:end')
  })
  const secondApply = queue.apply(async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await nextTick()
  assert.deepEqual(events, ['first:start'])

  first.resolve()
  await Promise.all([firstApply, secondApply])

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('ProxyApplyQueue continues with later apply calls after an earlier failure', async () => {
  const queue = new ProxyApplyQueue()
  const events: string[] = []

  const firstApply = queue.apply(async () => {
    events.push('first:start')
    throw new Error('apply failed')
  })
  const secondApply = queue.apply(async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await assert.rejects(firstApply, /apply failed/)
  await secondApply

  assert.deepEqual(events, ['first:start', 'second:start', 'second:end'])
})
