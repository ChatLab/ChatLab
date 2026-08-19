import assert from 'node:assert/strict'
import test from 'node:test'
import { createAIStreamTextBatcher, type AIStreamTextDelta } from './aiChatStreamBatcher'

function createManualScheduler() {
  let nextHandle = 1
  const callbacks = new Map<number, () => void>()
  return {
    scheduler: {
      request(callback: () => void) {
        const handle = nextHandle++
        callbacks.set(handle, callback)
        return handle
      },
      cancel(handle: number) {
        callbacks.delete(handle)
      },
    },
    runFrame() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback())
    },
    pendingCount() {
      return callbacks.size
    },
  }
}

test('merges adjacent text and thinking deltas within one frame', () => {
  const frame = createManualScheduler()
  const applied: AIStreamTextDelta[][] = []
  const batcher = createAIStreamTextBatcher((deltas) => applied.push(deltas), frame.scheduler)

  batcher.push({ type: 'content', content: 'A' })
  batcher.push({ type: 'content', content: 'B' })
  batcher.push({ type: 'think', thinkTag: 'analysis', content: 'C' })
  batcher.push({ type: 'think', thinkTag: 'analysis', content: 'D' })
  batcher.push({ type: 'content', content: 'E' })

  assert.equal(frame.pendingCount(), 1)
  frame.runFrame()
  assert.deepEqual(applied, [
    [
      { type: 'content', content: 'AB' },
      { type: 'think', thinkTag: 'analysis', content: 'CD' },
      { type: 'content', content: 'E' },
    ],
  ])
})

test('flushes queued deltas synchronously before a stream boundary', () => {
  const frame = createManualScheduler()
  const applied: AIStreamTextDelta[][] = []
  const batcher = createAIStreamTextBatcher((deltas) => applied.push(deltas), frame.scheduler)

  batcher.push({ type: 'content', content: 'before tool' })
  batcher.flush()

  assert.equal(frame.pendingCount(), 0)
  assert.deepEqual(applied, [[{ type: 'content', content: 'before tool' }]])
})

test('cancels the pending frame without applying stale deltas', () => {
  const frame = createManualScheduler()
  const applied: AIStreamTextDelta[][] = []
  const batcher = createAIStreamTextBatcher((deltas) => applied.push(deltas), frame.scheduler)

  batcher.push({ type: 'content', content: 'stale' })
  batcher.cancel()
  frame.runFrame()

  assert.deepEqual(applied, [])
})
