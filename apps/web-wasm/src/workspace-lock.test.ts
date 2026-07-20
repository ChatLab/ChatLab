import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WebWasmWorkspaceBusyError,
  acquireWebWasmWorkspaceLease,
  handleWebWasmWorkspacePageHide,
  type WebWasmLockManager,
  type WebWasmWorkspaceLease,
} from './workspace-lock'

describe('acquireWebWasmWorkspaceLease', () => {
  it('rejects a second Web WASM page while the workspace lock is occupied', async () => {
    const lockManager: WebWasmLockManager = {
      async request(_name, options, callback) {
        assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true })
        await callback(null)
      },
    }

    await assert.rejects(acquireWebWasmWorkspaceLease(lockManager), WebWasmWorkspaceBusyError)
  })

  it('holds the workspace lock until the lease is released', async () => {
    let requestCompleted = false
    const lockManager: WebWasmLockManager = {
      async request(_name, _options, callback) {
        await callback({})
        requestCompleted = true
      },
    }

    const lease = await acquireWebWasmWorkspaceLease(lockManager)
    assert.equal(requestCompleted, false)

    lease.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requestCompleted, true)

    lease.release()
  })
})

describe('handleWebWasmWorkspacePageHide', () => {
  it('keeps the workspace lease while the page enters the back-forward cache', () => {
    let releaseCount = 0
    const lease: WebWasmWorkspaceLease = {
      release() {
        releaseCount++
      },
    }

    const retainedLease = handleWebWasmWorkspacePageHide({ persisted: true }, lease)

    assert.equal(retainedLease, lease)
    assert.equal(releaseCount, 0)
  })

  it('releases and clears the workspace lease when the page is discarded', () => {
    let releaseCount = 0
    const lease: WebWasmWorkspaceLease = {
      release() {
        releaseCount++
      },
    }

    const retainedLease = handleWebWasmWorkspacePageHide({ persisted: false }, lease)

    assert.equal(retainedLease, undefined)
    assert.equal(releaseCount, 1)
  })
})
