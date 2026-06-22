import assert from 'node:assert/strict'
import test from 'node:test'
import { createSemanticIndexWorkerRuntime, type SemanticIndexWorkerServiceFactory } from './worker-runtime'
import type { SemanticIndexRuntime } from './runtime'

class FakeSemanticIndexRuntime implements Partial<SemanticIndexRuntime> {
  statusCalls: string[] = []
  closed = false

  status(sessionId: string) {
    this.statusCalls.push(sessionId)
    return null
  }

  close(): void {
    this.closed = true
  }

  recover(): void {
    /* no-op */
  }
}

test('worker runtime lazily creates service and forwards RPC calls', async () => {
  const services: FakeSemanticIndexRuntime[] = []
  const factory: SemanticIndexWorkerServiceFactory = () => {
    const service = new FakeSemanticIndexRuntime()
    services.push(service)
    return service as SemanticIndexRuntime
  }
  const runtime = createSemanticIndexWorkerRuntime({ serviceFactory: factory })

  assert.equal(services.length, 0)

  const result = await runtime.handleRequest('status', ['session-a'])

  assert.equal(result, null)
  assert.equal(services.length, 1)
  assert.deepEqual(services[0].statusCalls, ['session-a'])

  await runtime.close()

  assert.equal(services[0].closed, true)
})
