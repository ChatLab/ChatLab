import type { WebRuntimeWorkspaceChangeEvent } from '@openchatlab/web-runtime'

export const WEB_WASM_SESSION_SYNC_CHANNEL = 'chatlab-web-wasm-session-sync'

export interface WebWasmSessionSyncChannel {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  close(): void
}

export class WebWasmSessionSync {
  private readonly listeners = new Set<(event: WebRuntimeWorkspaceChangeEvent) => void>()

  constructor(private readonly channel: WebWasmSessionSyncChannel | undefined = createChannel()) {
    this.channel?.addEventListener('message', this.handleMessage)
  }

  publish(event: WebRuntimeWorkspaceChangeEvent): void {
    this.channel?.postMessage(event)
  }

  subscribe(listener: (event: WebRuntimeWorkspaceChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.channel?.removeEventListener('message', this.handleMessage)
    this.channel?.close()
    this.listeners.clear()
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (!isWorkspaceChangeEvent(event.data)) return
    for (const listener of this.listeners) listener(event.data)
  }
}

function createChannel(): WebWasmSessionSyncChannel | undefined {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(WEB_WASM_SESSION_SYNC_CHANNEL) : undefined
}

function isWorkspaceChangeEvent(value: unknown): value is WebRuntimeWorkspaceChangeEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<WebRuntimeWorkspaceChangeEvent>
  return (
    (event.type === 'import' || event.type === 'delete' || event.type === 'rename') &&
    typeof event.sessionId === 'string'
  )
}
