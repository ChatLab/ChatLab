import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WebRuntimeRpcClient, type RpcWorker } from './client'
import type { RpcResponseEnvelope } from './protocol'

class FakeWorker implements RpcWorker {
  readonly messages: unknown[] = []
  terminated = false
  private readonly messageListeners = new Set<(event: MessageEvent<RpcResponseEnvelope>) => void>()
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<RpcResponseEnvelope>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent<RpcResponseEnvelope>) => void)
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<RpcResponseEnvelope>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent<RpcResponseEnvelope>) => void)
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  emitMessage(message: RpcResponseEnvelope): void {
    for (const listener of this.messageListeners) {
      listener({ data: message } as MessageEvent<RpcResponseEnvelope>)
    }
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener({ error, message: error.message } as ErrorEvent)
    }
  }
}

describe('WebRuntimeRpcClient', () => {
  it('uses one request envelope and routes progress and result by request id', async () => {
    const worker = new FakeWorker()
    const progress: string[] = []
    const client = new WebRuntimeRpcClient(() => worker)

    const resultPromise = client.request(
      'db.open',
      { filename: '/session.db' },
      { onProgress: (event) => progress.push(event.stage) }
    )
    const request = worker.messages[0] as { id: string; type: string; payload: unknown }
    assert.match(request.id, /^rpc-/)
    assert.deepEqual(request, {
      id: request.id,
      type: 'db.open',
      payload: { filename: '/session.db' },
    })

    worker.emitMessage({
      id: request.id,
      type: 'progress',
      payload: { taskType: 'db.open', stage: 'sqlite-initializing', progress: 0.25 },
    })
    worker.emitMessage({
      id: request.id,
      type: 'result',
      payload: {
        taskType: 'db.open',
        result: { filename: '/session.db', sqliteVersion: '3.53.0', schemaVersion: 8 },
      },
    })

    assert.deepEqual(await resultPromise, {
      filename: '/session.db',
      sqliteVersion: '3.53.0',
      schemaVersion: 8,
    })
    assert.deepEqual(progress, ['sqlite-initializing'])
    client.dispose()
  })

  it('preserves structured worker errors', async () => {
    const worker = new FakeWorker()
    const client = new WebRuntimeRpcClient(() => worker)
    const resultPromise = client.request('db.close', undefined)
    const request = worker.messages[0] as { id: string }

    worker.emitMessage({
      id: request.id,
      type: 'error',
      payload: {
        taskType: 'db.close',
        error: { name: 'RuntimeError', code: 'DB_CLOSE_FAILED', message: 'Could not close database' },
      },
    })

    await assert.rejects(resultPromise, (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.equal((error as Error & { code?: string }).code, 'DB_CLOSE_FAILED')
      return true
    })
    client.dispose()
  })

  it('waits for worker cancellation acknowledgement before rejecting', async () => {
    const worker = new FakeWorker()
    const client = new WebRuntimeRpcClient(() => worker)
    const controller = new AbortController()
    const resultPromise = client.request('db.open', { filename: '/cancelled.db' }, { signal: controller.signal })
    const request = worker.messages[0] as { id: string }
    let settled = false
    void resultPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    controller.abort('user cancelled')

    assert.deepEqual(worker.messages[1], {
      id: request.id,
      type: 'cancel',
      payload: { reason: 'user cancelled' },
    })
    await Promise.resolve()
    assert.equal(settled, false)

    worker.emitMessage({
      id: request.id,
      type: 'error',
      payload: {
        taskType: 'db.open',
        error: { name: 'WebRuntimeError', code: 'REQUEST_CANCELLED', message: 'The Worker task was cancelled' },
      },
    })
    await assert.rejects(resultPromise, (error: unknown) => (error as Error).name === 'AbortError')
    client.dispose()
  })

  it('returns a mutating task result when it completes before cancellation acknowledgement', async () => {
    const worker = new FakeWorker()
    const client = new WebRuntimeRpcClient(() => worker)
    const controller = new AbortController()
    const resultPromise = client.request(
      'session.rename',
      { sessionId: 'session-one', name: 'Renamed' },
      { signal: controller.signal }
    )
    const request = worker.messages[0] as { id: string }

    controller.abort('user cancelled')
    worker.emitMessage({
      id: request.id,
      type: 'result',
      payload: { taskType: 'session.rename', result: { renamed: true } },
    })

    assert.deepEqual(await resultPromise, { renamed: true })
    client.dispose()
  })

  it('reports successful workspace mutations after the Worker releases storage', async () => {
    const worker = new FakeWorker()
    const changes: Array<{ type: string; sessionId: string }> = []
    const client = new WebRuntimeRpcClient(() => worker, {
      onWorkspaceChanged: (event) => changes.push(event),
    })

    const renamed = client.request('session.rename', { sessionId: 'session-one', name: 'Renamed' })
    const renameRequest = worker.messages[0] as { id: string }
    worker.emitMessage({
      id: renameRequest.id,
      type: 'result',
      payload: { taskType: 'session.rename', result: { renamed: true } },
    })
    await renamed

    const missingDelete = client.request('session.delete', { sessionId: 'missing' })
    const deleteRequest = worker.messages[1] as { id: string }
    worker.emitMessage({
      id: deleteRequest.id,
      type: 'result',
      payload: { taskType: 'session.delete', result: { deleted: false } },
    })
    await missingDelete

    const imported = client.request('import.start', {
      source: {
        name: 'fixture.json',
        size: 2,
        text: async () => '{}',
        arrayBuffer: async () => new ArrayBuffer(0),
        slice: () => new Blob(),
      },
    })
    const importRequest = worker.messages[2] as { id: string }
    worker.emitMessage({
      id: importRequest.id,
      type: 'result',
      payload: {
        taskType: 'import.start',
        result: {
          sessionId: 'session-two',
          formatId: 'chatlab',
          messageCount: 1,
          memberCount: 1,
          skippedCount: 0,
        },
      },
    })
    await imported

    assert.deepEqual(changes, [
      { type: 'rename', sessionId: 'session-one' },
      { type: 'import', sessionId: 'session-two' },
    ])
    client.dispose()
  })

  it('still resolves a mutation when the workspace change callback fails', async () => {
    const worker = new FakeWorker()
    const client = new WebRuntimeRpcClient(() => worker, {
      onWorkspaceChanged: () => {
        throw new Error('channel closed')
      },
    })
    const originalError = console.error
    console.error = () => undefined

    try {
      const renamed = client.request('session.rename', { sessionId: 'session-one', name: 'Renamed' })
      const request = worker.messages[0] as { id: string }
      worker.emitMessage({
        id: request.id,
        type: 'result',
        payload: { taskType: 'session.rename', result: { renamed: true } },
      })

      assert.deepEqual(await renamed, { renamed: true })
    } finally {
      console.error = originalError
      client.dispose()
    }
  })

  it('rejects pending work after a crash and creates a fresh worker for the next request', async () => {
    const workers: FakeWorker[] = []
    const client = new WebRuntimeRpcClient(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })

    const interrupted = client.request('db.close', undefined)
    workers[0].emitError(new Error('worker crashed'))
    await assert.rejects(interrupted, (error: unknown) => {
      assert.equal((error as Error & { code?: string }).code, 'WORKER_CRASHED')
      return true
    })
    assert.equal(workers[0].terminated, true)

    const recovered = client.request('capabilities.check', undefined)
    assert.equal(workers.length, 2)
    const request = workers[1].messages[0] as { id: string }
    workers[1].emitMessage({
      id: request.id,
      type: 'result',
      payload: {
        taskType: 'capabilities.check',
        result: {
          supported: true,
          missing: [],
          capabilities: {
            webAssembly: true,
            dedicatedWorker: true,
            opfs: true,
            storageEstimate: true,
            secureContext: true,
          },
        },
      },
    })
    assert.equal((await recovered).supported, true)
    client.dispose()
  })
})
