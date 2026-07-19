import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type {
  RpcProgressPayload,
  RpcRequestOptions,
  WebRuntimeTaskPayload,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from '@openchatlab/web-runtime'
import { BrowserRuntimeAdapter } from './browser'

interface RecordedRequest {
  type: WebRuntimeTaskType
  payload: unknown
  options: RpcRequestOptions
}

function createRpcPort() {
  const requests: RecordedRequest[] = []
  let disposed = false

  return {
    requests,
    get disposed() {
      return disposed
    },
    port: {
      async request<T extends WebRuntimeTaskType>(
        type: T,
        payload: WebRuntimeTaskPayload<T>,
        options: RpcRequestOptions = {}
      ): Promise<WebRuntimeTaskResult<T>> {
        requests.push({ type, payload, options })
        const result =
          type === 'capabilities.check'
            ? {
                supported: true,
                missing: [],
                capabilities: {
                  webAssembly: true,
                  dedicatedWorker: true,
                  opfs: true,
                  storageEstimate: true,
                  secureContext: true,
                },
              }
            : type === 'db.open'
              ? { filename: '/chatlab.db', sqliteVersion: '3.53.0', schemaVersion: 0 }
              : { closed: true }
        return result as WebRuntimeTaskResult<T>
      },
      dispose(): void {
        disposed = true
      },
    },
  }
}

describe('BrowserRuntimeAdapter', () => {
  it('forwards capability and database lifecycle calls to the Worker RPC client', async () => {
    const fake = createRpcPort()
    const adapter = new BrowserRuntimeAdapter(fake.port)

    const capabilities = await adapter.checkCapabilities()
    const opened = await adapter.openDatabase('/chatlab.db')
    const closed = await adapter.closeDatabase()
    adapter.dispose()

    assert.equal(capabilities.supported, true)
    assert.equal(opened.filename, '/chatlab.db')
    assert.deepEqual(closed, { closed: true })
    assert.deepEqual(
      fake.requests.map(({ type, payload }) => ({ type, payload })),
      [
        { type: 'capabilities.check', payload: undefined },
        { type: 'db.open', payload: { filename: '/chatlab.db' } },
        { type: 'db.close', payload: undefined },
      ]
    )
    assert.equal(fake.disposed, true)
  })

  it('preserves cancellation and progress options at the service boundary', async () => {
    const fake = createRpcPort()
    const adapter = new BrowserRuntimeAdapter(fake.port)
    const controller = new AbortController()
    const progress: RpcProgressPayload[] = []

    await adapter.openDatabase('/chatlab.db', {
      signal: controller.signal,
      onProgress: (event) => progress.push(event),
    })

    assert.equal(fake.requests[0].options.signal, controller.signal)
    fake.requests[0].options.onProgress?.({ taskType: 'db.open', stage: 'schema-ready', progress: 1 })
    assert.deepEqual(progress, [{ taskType: 'db.open', stage: 'schema-ready', progress: 1 }])
  })
})
