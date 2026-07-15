import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCaptureBoxSizing, waitForCaptureLayoutStabilization } from './captureLayout'

describe('resolveCaptureBoxSizing', () => {
  it('adds frame width without narrowing the captured content', () => {
    assert.deepEqual(
      resolveCaptureBoxSizing({
        currentWidth: 720,
        frameHorizontalPadding: 40,
      }),
      {
        contentWidth: 720,
        outerWidth: 800,
        didChangeContentWidth: false,
      }
    )
  })

  it('keeps frame padding outside the progressively narrowed content', () => {
    assert.deepEqual(
      resolveCaptureBoxSizing({
        currentWidth: 900,
        progressiveNarrowing: true,
        frameHorizontalPadding: 40,
      }),
      {
        contentWidth: 638,
        outerWidth: 718,
        didChangeContentWidth: true,
      }
    )
  })
})

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
