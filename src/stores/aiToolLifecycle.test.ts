import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createToolLifecycleTracker } from './aiToolLifecycle'

describe('createToolLifecycleTracker', () => {
  it('keeps remaining parallel calls active and routes progress by toolCallId', () => {
    const tracker = createToolLifecycleTracker()

    tracker.start({ name: 'lookup', toolCallId: 'slow-call' })
    tracker.start({ name: 'lookup', toolCallId: 'fast-call' })

    const afterFastCall = tracker.finish({ name: 'lookup', toolCallId: 'fast-call', status: 'done' })
    assert.equal(afterFastCall?.toolCallId, 'slow-call')
    assert.equal(afterFastCall?.status, 'running')

    const progressing = tracker.update({
      name: 'lookup',
      toolCallId: 'slow-call',
      progress: { phase: 'searching' },
    })
    assert.deepEqual(progressing?.progress, { phase: 'searching' })

    const finished = tracker.finish({ name: 'lookup', toolCallId: 'slow-call', status: 'done' })
    assert.equal(finished?.toolCallId, 'slow-call')
    assert.equal(finished?.status, 'done')
    assert.equal(tracker.current(), null)
  })
})
