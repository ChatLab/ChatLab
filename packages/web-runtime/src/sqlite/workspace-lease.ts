export const WEB_RUNTIME_WORKSPACE_LOCK = 'chatlab-web-wasm-opfs-workspace'

export interface WebRuntimeLockManager {
  request(name: string, options: { mode: 'exclusive' }, callback: (lock: object) => Promise<void>): Promise<void>
}

export interface WebRuntimeWorkspaceLease {
  release(): void
}

export function getWebRuntimeLockManager(): WebRuntimeLockManager | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { locks?: WebRuntimeLockManager }).locks
}

export async function acquireWebRuntimeWorkspaceLease(
  lockManager: WebRuntimeLockManager | undefined = getWebRuntimeLockManager()
): Promise<WebRuntimeWorkspaceLease> {
  if (!lockManager) return { release: () => undefined }

  let releaseLock: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  let releaseCalled = false
  const lease: WebRuntimeWorkspaceLease = {
    release() {
      if (releaseCalled) return
      releaseCalled = true
      releaseLock()
    },
  }

  let resolveAcquired!: (lease: WebRuntimeWorkspaceLease) => void
  let rejectAcquired!: (error: unknown) => void
  const acquired = new Promise<WebRuntimeWorkspaceLease>((resolve, reject) => {
    resolveAcquired = resolve
    rejectAcquired = reject
  })

  void lockManager
    .request(WEB_RUNTIME_WORKSPACE_LOCK, { mode: 'exclusive' }, async () => {
      resolveAcquired(lease)
      await released
    })
    .catch(rejectAcquired)

  return acquired
}
