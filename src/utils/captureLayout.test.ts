import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { waitForCaptureLayoutStabilization } from './captureLayout'

describe('waitForCaptureLayoutStabilization', () => {
  it('waits for layout, dispatches resize, then waits for chart repaint', async () => {
    const calls: string[] = []

    await waitForCaptureLayoutStabilization({
      waitFrame: async () => {
        calls.push('frame')
      },
      dispatchResize: () => {
        calls.push('resize')
      },
    })

    assert.deepEqual(calls, ['frame', 'resize', 'frame'])
  })
})
