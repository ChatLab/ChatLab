import { handleWebWasmPageHide } from './runtime-lifecycle'

export const WEB_WASM_WORKSPACE_LOCK = 'chatlab-web-wasm-opfs-workspace'

export interface WebWasmLockManager {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: object | null) => Promise<void>
  ): Promise<void>
}

export interface WebWasmWorkspaceLease {
  release(): void
}

export class WebWasmWorkspaceBusyError extends Error {
  readonly code = 'OPFS_WORKSPACE_BUSY'

  constructor() {
    super('The Web WASM workspace is already open in another tab')
    this.name = 'WebWasmWorkspaceBusyError'
  }
}

export function handleWebWasmWorkspacePageHide(
  event: Pick<PageTransitionEvent, 'persisted'>,
  lease: WebWasmWorkspaceLease | undefined
): WebWasmWorkspaceLease | undefined {
  let retainedLease = lease
  handleWebWasmPageHide(event, () => {
    lease?.release()
    retainedLease = undefined
  })
  return retainedLease
}

export async function acquireWebWasmWorkspaceLease(
  lockManager: WebWasmLockManager | undefined
): Promise<WebWasmWorkspaceLease> {
  if (!lockManager) return { release: () => undefined }

  let releaseLock: () => void = () => undefined
  const lockReleased = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  let released = false
  const lease: WebWasmWorkspaceLease = {
    release() {
      if (released) return
      released = true
      releaseLock()
    },
  }

  let resolveAcquired!: (lease: WebWasmWorkspaceLease) => void
  let rejectAcquired!: (error: unknown) => void
  const acquired = new Promise<WebWasmWorkspaceLease>((resolve, reject) => {
    resolveAcquired = resolve
    rejectAcquired = reject
  })

  void lockManager
    .request(WEB_WASM_WORKSPACE_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        rejectAcquired(new WebWasmWorkspaceBusyError())
        return
      }
      resolveAcquired(lease)
      await lockReleased
    })
    .catch(rejectAcquired)

  return acquired
}
