import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveDefaultBatchConcurrency, runKeyedBatch } from './batch-coordinator'

test('uses two workers by default and degrades on low-resource runtimes', () => {
  assert.equal(resolveDefaultBatchConcurrency(100, { cpuCount: 8, totalMemoryBytes: 16 * 1024 ** 3 }), 2)
  assert.equal(resolveDefaultBatchConcurrency(100, { cpuCount: 2, totalMemoryBytes: 16 * 1024 ** 3 }), 1)
  assert.equal(resolveDefaultBatchConcurrency(100, { cpuCount: 8, totalMemoryBytes: 2 * 1024 ** 3 }), 1)
  assert.equal(resolveDefaultBatchConcurrency(1, { cpuCount: 8, totalMemoryBytes: 16 * 1024 ** 3 }), 1)
})

test('runs different keys concurrently and serializes identical keys', async () => {
  let active = 0
  let maxActive = 0
  const activeKeys = new Set<string>()
  const tasks = [
    { value: 'a-1', key: 'a' },
    { value: 'b-1', key: 'b' },
    { value: 'a-2', key: 'a' },
    { value: 'c-1', key: 'c' },
  ]

  const results = await runKeyedBatch(tasks, {
    concurrency: 2,
    async run(value, index) {
      const key = tasks[index].key
      assert.equal(activeKeys.has(key), false)
      activeKeys.add(key)
      active++
      maxActive = Math.max(maxActive, active)
      await delay(5)
      active--
      activeKeys.delete(key)
      return value
    },
  })

  assert.equal(maxActive, 2)
  assert.deepEqual(
    results.map((result) => (result.status === 'success' ? result.value : result.status)),
    ['a-1', 'b-1', 'a-2', 'c-1']
  )
})

test('treats exclusive work as an ordering barrier', async () => {
  const events: string[] = []
  const tasks = [
    { value: 'before', key: 'before' },
    { value: 'exclusive', key: 'exclusive', exclusive: true },
    { value: 'after', key: 'after' },
  ]

  await runKeyedBatch(tasks, {
    concurrency: 3,
    async run(value) {
      events.push(`start:${value}`)
      await delay(2)
      events.push(`end:${value}`)
      return value
    },
  })

  assert.deepEqual(events, [
    'start:before',
    'end:before',
    'start:exclusive',
    'end:exclusive',
    'start:after',
    'end:after',
  ])
})

test('does not start pending work after cancellation and keeps completed results', async () => {
  const controller = new AbortController()
  let releaseFirst!: () => void
  const firstRunning = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const started: string[] = []

  const resultPromise = runKeyedBatch(
    [
      { value: 'first', key: 'first' },
      { value: 'second', key: 'second' },
      { value: 'third', key: 'third' },
    ],
    {
      concurrency: 1,
      signal: controller.signal,
      async run(value) {
        started.push(value)
        if (value === 'first') await firstRunning
        return value
      },
    }
  )

  await delay(0)
  controller.abort()
  releaseFirst()
  const results = await resultPromise

  assert.deepEqual(started, ['first'])
  assert.deepEqual(
    results.map((result) => result.status),
    ['success', 'cancelled', 'cancelled']
  )
})

test('aggregates failures without stopping independent work', async () => {
  const results = await runKeyedBatch(
    [
      { value: 'ok-1', key: 'a' },
      { value: 'bad', key: 'b' },
      { value: 'ok-2', key: 'c' },
    ],
    {
      concurrency: 2,
      async run(value) {
        if (value === 'bad') throw new Error('expected failure')
        return value
      },
    }
  )

  assert.deepEqual(results, [
    { status: 'success', value: 'ok-1' },
    { status: 'failed', error: 'expected failure' },
    { status: 'success', value: 'ok-2' },
  ])
})
