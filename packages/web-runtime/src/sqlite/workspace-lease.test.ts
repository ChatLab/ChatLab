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

  request(name: string, options: { mode: 'exclusive' }, callback: (lock: object) => Promise<void>): Promise<void> {
    assert.equal(name, WEB_RUNTIME_WORKSPACE_LOCK)
    assert.deepEqual(options, { mode: 'exclusive' })
    return new Promise<void>((resolve, reject) => {
      const run = () => {
        this.active = true
        void callback({})
          .then(resolve, reject)
          .finally(() => {
            this.active = false
            this.queue.shift()?.()
          })
      }
      if (this.active) {
        this.queue.push(run)
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

  it('returns a no-op lease when Web Locks is unavailable', async () => {
    const lease = await acquireWebRuntimeWorkspaceLease(undefined)

    assert.doesNotThrow(() => lease.release())
    assert.doesNotThrow(() => lease.release())
  })
})
