import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { waitForCaptureLayoutStabilization } from './captureLayout'

describe('waitForCaptureLayoutStabilization', () => {
  it('waits for layout without broadcasting resize when the capture width is unchanged', async () => {
    const calls: string[] = []

    await waitForCaptureLayoutStabilization({
      waitFrame: async () => {
        calls.push('frame')
      },
      dispatchResize: () => {
        calls.push('resize')
      },
    })

    assert.deepEqual(calls, ['frame', 'frame'])
  })

  it('dispatches resize between frames when the capture width changes', async () => {
    const calls: string[] = []

    await waitForCaptureLayoutStabilization({
      resizeCharts: true,
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
