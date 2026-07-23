import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WEB_RUNTIME_WORKSPACE_LOCK,
  acquireWebRuntimeWorkspaceLease,
  type WebRuntimeLockManager,
} from './workspace-lease'

class QueuedLockManager implements WebRuntimeLockManager {
  private active = false
  private readonly queue: Array<() => void> = []
  grantCount = 0

  request(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: (lock: object) => Promise<void>
  ): Promise<void> {
    assert.equal(name, WEB_RUNTIME_WORKSPACE_LOCK)
    assert.equal(options.mode, 'exclusive')
    return new Promise<void>((resolve, reject) => {
      let queued = true
      const cleanup = () => options.signal?.removeEventListener('abort', abort)
      const abort = () => {
        if (!queued) return
        queued = false
        const index = this.queue.indexOf(run)
        if (index >= 0) this.queue.splice(index, 1)
        cleanup()
        reject(options.signal?.reason ?? new DOMException('The lock request was aborted', 'AbortError'))
      }
      const run = () => {
        if (!queued) return
        queued = false
        cleanup()
        this.active = true
        this.grantCount += 1
        void callback({})
          .then(resolve, reject)
          .finally(() => {
            this.active = false
            this.queue.shift()?.()
          })
      }

      if (options.signal?.aborted) {
        abort()
        return
      }
      if (this.active) {
        this.queue.push(run)
        options.signal?.addEventListener('abort', abort, { once: true })
      } else {
        run()
      }
    })
  }
}

describe('acquireWebRuntimeWorkspaceLease', () => {
  it('queues a second workspace lease until the first lease is released', async () => {
    const manager = new QueuedLockManager()
    const first = await acquireWebRuntimeWorkspaceLease(manager)
    let secondAcquired = false
    const secondPromise = acquireWebRuntimeWorkspaceLease(manager).then((lease) => {
      secondAcquired = true
      return lease
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(secondAcquired, false)

    first.release()
    const second = await secondPromise
    assert.equal(secondAcquired, true)
    second.release()
  })

  it('cancels a queued workspace lease before the active lease is released', async () => {
    const manager = new QueuedLockManager()
    const first = await acquireWebRuntimeWorkspaceLease(manager)
    const controller = new AbortController()
    const cancellation = new Error('cancelled')
    const secondPromise = acquireWebRuntimeWorkspaceLease(manager, controller.signal)
    let rejected = false
    void secondPromise.catch(() => {
      rejected = true
    })

    try {
      controller.abort(cancellation)
      await new Promise<void>((resolve) => setImmediate(resolve))

      assert.equal(rejected, true)
      assert.equal(manager.grantCount, 1)
      await assert.rejects(secondPromise, (error) => error === cancellation)
    } finally {
      first.release()
    }
  })

  it('returns a no-op lease when Web Locks is unavailable', async () => {
    const lease = await acquireWebRuntimeWorkspaceLease(undefined)

    assert.doesNotThrow(() => lease.release())
    assert.doesNotThrow(() => lease.release())
  })
})
