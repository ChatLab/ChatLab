import assert from 'node:assert/strict'
import { it } from 'node:test'

import { isAbortError, resolveSendTarget } from './send-lifecycle'

it('does not continue a send when cancellation happens while its conversation is being created', async () => {
  const controller = new AbortController()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let continued = false

  const target = resolveSendTarget(controller.signal, async (signal) => {
    assert.equal(signal, controller.signal)
    await gate
    return 'conversation-1'
  }).then(() => {
    continued = true
  })

  controller.abort()
  release()

  await assert.rejects(target, (error: unknown) => error instanceof DOMException && error.name === 'AbortError')
  assert.equal(continued, false)
})

it('recognizes the AbortError-shaped Error returned by Browser Runtime RPC', () => {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'

  assert.equal(isAbortError(error), true)
})
