import type {
  RpcProgressPayload,
  RpcResponseEnvelope,
  RuntimeLogEvent,
  SerializedRpcError,
  WebRuntimeTaskPayload,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from './protocol'

type RpcWorkerListener = (event: any) => void

export interface RpcWorker {
  postMessage(message: unknown): void
  addEventListener(type: 'message' | 'error', listener: RpcWorkerListener): void
  removeEventListener(type: 'message' | 'error', listener: RpcWorkerListener): void
  terminate(): void
}

export interface RpcRequestOptions {
  signal?: AbortSignal
  onProgress?: (event: RpcProgressPayload) => void
}

export interface WebRuntimeRpcClientOptions {
  onLog?: (event: RuntimeLogEvent) => void
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  onProgress?: (event: RpcProgressPayload) => void
  removeAbortListener?: () => void
}

export class WebRuntimeRpcError extends Error {
  readonly code: string

  constructor(error: SerializedRpcError) {
    super(error.message)
    this.name = error.name
    this.code = error.code
    this.stack = error.stack ?? this.stack
  }
}

export class WebRuntimeRpcClient {
  private worker: RpcWorker | undefined
  private readonly pending = new Map<string, PendingRequest>()
  private requestSequence = 0
  private disposed = false

  constructor(
    private readonly workerFactory: () => RpcWorker,
    private readonly options: WebRuntimeRpcClientOptions = {}
  ) {}

  request<T extends WebRuntimeTaskType>(
    type: T,
    payload: WebRuntimeTaskPayload<T>,
    options: RpcRequestOptions = {}
  ): Promise<WebRuntimeTaskResult<T>> {
    if (this.disposed) {
      return Promise.reject(createClientError('CLIENT_DISPOSED', 'Web runtime RPC client has been disposed'))
    }
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError(options.signal.reason))
    }

    const id = `rpc-${Date.now().toString(36)}-${++this.requestSequence}`
    const worker = this.ensureWorker()

    return new Promise<WebRuntimeTaskResult<T>>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress,
      }

      if (options.signal) {
        const handleAbort = () => {
          if (!this.pending.has(id)) return
          worker.postMessage({
            id,
            type: 'cancel',
            payload: { reason: normalizeAbortReason(options.signal?.reason) },
          })
          this.settleRequest(id, 'reject', createAbortError(options.signal?.reason))
        }
        options.signal.addEventListener('abort', handleAbort, { once: true })
        pending.removeAbortListener = () => options.signal?.removeEventListener('abort', handleAbort)
      }

      this.pending.set(id, pending)
      try {
        worker.postMessage({ id, type, payload })
      } catch (error) {
        this.settleRequest(id, 'reject', normalizeError(error, 'POST_MESSAGE_FAILED'))
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rejectAll(createClientError('CLIENT_DISPOSED', 'Web runtime RPC client has been disposed'))
    this.resetWorker()
  }

  private ensureWorker(): RpcWorker {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.addEventListener('message', this.handleMessage)
    worker.addEventListener('error', this.handleWorkerError)
    this.worker = worker
    return worker
  }

  private readonly handleMessage = (event: MessageEvent<RpcResponseEnvelope>): void => {
    const envelope = event.data
    if (envelope?.type === 'log') {
      this.options.onLog?.(envelope.payload)
      return
    }
    const pending = this.pending.get(envelope?.id)
    if (!pending) return

    if (envelope.type === 'progress') {
      pending.onProgress?.(envelope.payload)
      return
    }
    if (envelope.type === 'result') {
      this.settleRequest(envelope.id, 'resolve', envelope.payload.result)
      return
    }
    this.settleRequest(envelope.id, 'reject', new WebRuntimeRpcError(envelope.payload.error))
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const error = createClientError('WORKER_CRASHED', event.message || 'Web runtime Worker crashed')
    if (event.error instanceof Error && event.error.stack) error.stack = event.error.stack
    this.rejectAll(error)
    this.resetWorker()
  }

  private settleRequest(id: string, action: 'resolve' | 'reject', value: unknown): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.removeAbortListener?.()
    if (action === 'resolve') {
      pending.resolve(value)
    } else {
      pending.reject(value as Error)
    }
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.settleRequest(id, 'reject', error)
    }
  }

  private resetWorker(): void {
    if (!this.worker) return
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    this.worker.terminate()
    this.worker = undefined
  }
}

function createClientError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function normalizeError(error: unknown, code: string): Error & { code: string } {
  if (error instanceof Error) return Object.assign(error, { code })
  return createClientError(code, String(error))
}

function normalizeAbortReason(reason: unknown): string | undefined {
  if (reason === undefined) return undefined
  return reason instanceof Error ? reason.message : String(reason)
}

function createAbortError(reason: unknown): Error {
  const error = new Error(normalizeAbortReason(reason) || 'The operation was aborted')
  error.name = 'AbortError'
  return error
}
