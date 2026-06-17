import assert from 'node:assert/strict'
import test from 'node:test'
import { SemanticIndexJobQueue, type JobContext } from './job-queue'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

test('processes enqueued jobs serially in order', async () => {
  const order: string[] = []
  const queue = new SemanticIndexJobQueue(async ({ job }) => {
    order.push(`${job.type}:${job.dbPathHash}`)
  })

  queue.enqueue({ type: 'build', dbPathHash: 'a' })
  queue.enqueue({ type: 'build', dbPathHash: 'b' })
  queue.enqueue({ type: 'cleanup', dbPathHash: 'a' })
  await queue.whenIdle()

  assert.deepEqual(order, ['build:a', 'build:b', 'cleanup:a'])
})

test('deduplicates same conversation + type while pending', async () => {
  let runs = 0
  const gate = deferred()
  const queue = new SemanticIndexJobQueue(async ({ job }) => {
    runs++
    if (job.dbPathHash === 'a') await gate.promise
  })

  queue.enqueue({ type: 'build', dbPathHash: 'a' }) // starts and blocks on gate
  queue.enqueue({ type: 'build', dbPathHash: 'b' })
  queue.enqueue({ type: 'build', dbPathHash: 'b' }) // duplicate of pending b -> ignored
  gate.resolve()
  await queue.whenIdle()

  assert.equal(runs, 2)
})

test('pause signals stop to the running job and drops its pending work', async () => {
  const started = deferred()
  let observedStop: string | null = null
  const release = deferred()

  const queue = new SemanticIndexJobQueue(async ({ checkStop }: JobContext) => {
    started.resolve()
    await release.promise
    observedStop = checkStop()
  })

  queue.enqueue({ type: 'build', dbPathHash: 'a' })
  await started.promise
  queue.pause('a')
  release.resolve()
  await queue.whenIdle()

  assert.equal(observedStop, 'paused')
})

test('cancel signals cancelled to the running job', async () => {
  const started = deferred()
  let observedStop: string | null = null
  const release = deferred()

  const queue = new SemanticIndexJobQueue(async ({ checkStop }) => {
    started.resolve()
    await release.promise
    observedStop = checkStop()
  })

  queue.enqueue({ type: 'build', dbPathHash: 'a' })
  await started.promise
  queue.cancel('a')
  release.resolve()
  await queue.whenIdle()

  assert.equal(observedStop, 'cancelled')
})

test('executor failure does not stop the queue', async () => {
  const seen: string[] = []
  const queue = new SemanticIndexJobQueue(async ({ job }) => {
    seen.push(job.dbPathHash)
    if (job.dbPathHash === 'a') throw new Error('boom')
  })

  queue.enqueue({ type: 'build', dbPathHash: 'a' })
  queue.enqueue({ type: 'build', dbPathHash: 'b' })
  await queue.whenIdle()

  assert.deepEqual(seen, ['a', 'b'])
})

test('isQueued reflects pending and running state', async () => {
  const gate = deferred()
  const queue = new SemanticIndexJobQueue(async () => {
    await gate.promise
  })

  queue.enqueue({ type: 'build', dbPathHash: 'a' })
  queue.enqueue({ type: 'build', dbPathHash: 'b' })
  assert.equal(queue.isQueued('a'), true)
  assert.equal(queue.isQueued('b'), true)
  assert.equal(queue.isQueued('c'), false)
  gate.resolve()
  await queue.whenIdle()
  assert.equal(queue.isQueued('a'), false)
})
