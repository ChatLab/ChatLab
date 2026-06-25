import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSemanticIndexWorkerRuntime,
  createSemanticIndexWorkerServiceFactory,
  type SemanticIndexWorkerServiceFactory,
} from './worker-runtime'
import type { SemanticIndexRuntime } from './runtime'
import type { SemanticIndexWorkerStartupOptions } from './worker-runtime'

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

function makeStartupOptions(logsDir: string): SemanticIndexWorkerStartupOptions {
  return {
    paths: {
      systemDir: '/tmp/system',
      userDataDir: '/tmp/data',
      databaseDir: '/tmp/data/databases',
      vectorDir: '/tmp/data/vector',
      aiDataDir: '/tmp/system/ai',
      settingsDir: '/tmp/system/settings',
      cacheDir: '/tmp/system/cache',
      tempDir: '/tmp/system/temp',
      logsDir,
      downloadsDir: '/tmp/downloads',
    },
    runtime: { version: '0.0.0-test', kind: 'cli' },
  }
}

test('worker runtime lazily creates service and forwards RPC calls', async () => {
  const services: FakeSemanticIndexRuntime[] = []
  const factory: SemanticIndexWorkerServiceFactory = () => {
    const service = new FakeSemanticIndexRuntime()
    services.push(service)
    return service as unknown as SemanticIndexRuntime
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

test('worker service factory initializes app logger with worker logs dir', () => {
  const calls: string[] = []

  createSemanticIndexWorkerServiceFactory(makeStartupOptions('/tmp/system/logs'), {
    initLogger: (logsDir) => calls.push(logsDir),
  })

  assert.deepEqual(calls, ['/tmp/system/logs'])
})
