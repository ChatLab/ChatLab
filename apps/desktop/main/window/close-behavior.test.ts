import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DesktopCloseBehavior } from '@openchatlab/shared-types'
import { WindowsCloseController } from './close-behavior'

interface HarnessOptions {
  preference?: DesktopCloseBehavior
  promptResult?: { action: 'background' | 'quit' | 'cancel'; remember: boolean }
}

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = []
  let resolvePrompt: (() => void) | undefined
  const promptGate = new Promise<void>((resolve) => {
    resolvePrompt = resolve
  })
  let waitForPrompt = false

  const controller = new WindowsCloseController({
    readPreference: () => options.preference ?? 'ask',
    savePreference: (preference) => calls.push(`save:${preference}`),
    prompt: async () => {
      calls.push('prompt')
      if (waitForPrompt) await promptGate
      return options.promptResult ?? { action: 'cancel', remember: false }
    },
    enterBackground: () => calls.push('background'),
    quit: () => calls.push('quit'),
    onError: (error) => calls.push(`error:${String(error)}`),
  })

  return {
    calls,
    controller,
    holdPrompt: () => {
      waitForPrompt = true
    },
    releasePrompt: () => resolvePrompt?.(),
  }
}

describe('WindowsCloseController', () => {
  it('applies remembered background and quit choices without prompting', async () => {
    for (const preference of ['background', 'quit'] as const) {
      const harness = createHarness({ preference })

      await harness.controller.requestClose()

      assert.deepEqual(harness.calls, [preference])
    }
  })

  it('remembers the selected action only when the checkbox is enabled', async () => {
    const remembered = createHarness({ promptResult: { action: 'background', remember: true } })
    await remembered.controller.requestClose()
    assert.deepEqual(remembered.calls, ['prompt', 'save:background', 'background'])

    const oneTime = createHarness({ promptResult: { action: 'quit', remember: false } })
    await oneTime.controller.requestClose()
    assert.deepEqual(oneTime.calls, ['prompt', 'quit'])
  })

  it('keeps the window open when the prompt is cancelled', async () => {
    const harness = createHarness({ promptResult: { action: 'cancel', remember: true } })

    await harness.controller.requestClose()

    assert.deepEqual(harness.calls, ['prompt'])
  })

  it('coalesces repeated close requests while the prompt is open', async () => {
    const harness = createHarness({ promptResult: { action: 'background', remember: false } })
    harness.holdPrompt()

    const first = harness.controller.requestClose()
    const second = harness.controller.requestClose()
    assert.deepEqual(harness.calls, ['prompt'])

    harness.releasePrompt()
    await Promise.all([first, second])
    assert.deepEqual(harness.calls, ['prompt', 'background'])
  })
})
