import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SemanticIndexConfigStore, type SemanticIndexConfig } from './config'
import type { SemanticIndexSessionStatus } from './service'
import {
  createSemanticIndexWorkerClient,
  type SemanticIndexWorkerTransport,
  type SemanticIndexWorkerTransportFactory,
} from './worker-client'

function makeConfigStore(): SemanticIndexConfigStore {
  const dir = fs.mkdtempSync(
    path.join(fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir(), 'chatlab-si-client-')
  )
  return new SemanticIndexConfigStore(path.join(dir, 'semantic-index-config.json'))
}

class FakeTransport implements SemanticIndexWorkerTransport {
  requests: Array<{ method: string; args: unknown[] }> = []
  closed = false

  constructor(private readonly handler?: (method: string, args: unknown[]) => unknown) {}

  async request<T>(method: string, args: unknown[]): Promise<T> {
    this.requests.push({ method, args })
    if (this.handler) return (await this.handler(method, args)) as T
    if (method === 'status') {
      return null as T
    }
    if (method === 'setConfig') {
      return args[0] as T
    }
    throw new Error(`unexpected method: ${method}`)
  }

  close(): void {
    this.closed = true
  }
}

function makeFactory(
  instances: FakeTransport[],
  handler?: (method: string, args: unknown[]) => unknown
): SemanticIndexWorkerTransportFactory {
  return () => {
    const transport = new FakeTransport(handler)
    instances.push(transport)
    return transport
  }
}

function makeStatus(sessionId: string, active: boolean): SemanticIndexSessionStatus {
  return {
    sessionId,
    enabled: true,
    indexStatus: active ? 'running' : 'completed',
    needsRebuild: false,
    totalMessages: 10,
    indexedMessages: active ? 5 : 10,
    chunkCount: active ? 1 : 2,
    coverage: active ? 0.5 : 1,
    queued: false,
    running: active,
    partial: active,
    error: null,
    modelId: 'model-a',
  }
}

test('worker client keeps config-only operations in process without starting worker', async () => {
  const instances: FakeTransport[] = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances),
    idleTimeoutMs: 1000,
  })

  const initial = await client.getConfig()
  await client.setConfig({ ...initial, enabled: false })
  const saved = await client.getConfig()

  assert.equal(saved.enabled, false)
  assert.equal(instances.length, 0)
})

test('worker client returns unavailable for unconfigured canSearch without starting worker', async () => {
  const instances: FakeTransport[] = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances),
    idleTimeoutMs: 1000,
  })

  const available = await client.canSearch('session-a')

  assert.equal(available, false)
  assert.equal(instances.length, 0)
})

test('worker client treats canSearch worker failures as unavailable', async () => {
  const instances: FakeTransport[] = []
  const configStore = makeConfigStore()
  configStore.set({ version: 1, mode: 'local', local: { modelId: 'model-a' }, api: null })
  const client = createSemanticIndexWorkerClient({
    configStore,
    transportFactory: makeFactory(instances, () => {
      throw new Error('worker failed to start')
    }),
    idleTimeoutMs: 1000,
  })

  const available = await client.canSearch('session-a')

  assert.equal(available, false)
  assert.equal(instances.length, 1)
  assert.equal(instances[0].closed, true)
})

test('worker client treats status worker failures as unavailable', async () => {
  const instances: FakeTransport[] = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances, () => {
      throw new Error('worker failed to start')
    }),
    idleTimeoutMs: 1000,
  })

  const status = await client.status('session-a')

  assert.equal(status, null)
  assert.equal(instances.length, 1)
  assert.equal(instances[0].closed, true)
})

test('worker client lazy-starts for runtime calls and closes after idle timeout', async () => {
  const instances: FakeTransport[] = []
  const timers: Array<() => void> = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances),
    idleTimeoutMs: 1000,
    timers: {
      setTimeout(callback) {
        timers.push(callback)
        return callback
      },
      clearTimeout() {
        /* test timer is manually triggered */
      },
    },
  })

  assert.equal(instances.length, 0)

  const status = await client.status('session-a')

  assert.equal(status, null)
  assert.equal(instances.length, 1)
  assert.deepEqual(instances[0].requests, [{ method: 'status', args: ['session-a'] }])
  assert.equal(instances[0].closed, false)

  timers.shift()?.()

  assert.equal(instances[0].closed, true)
})

test('worker client forwards config updates to a live worker without starting a new one', async () => {
  const instances: FakeTransport[] = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances),
    idleTimeoutMs: 1000,
  })

  await client.status('session-a')
  const initial = await client.getConfig()
  const updated: SemanticIndexConfig = { ...initial, enabled: false }

  const saved = await client.setConfig(updated)

  assert.equal(saved.enabled, false)
  assert.equal(instances.length, 1)
  assert.deepEqual(instances[0].requests, [
    { method: 'status', args: ['session-a'] },
    { method: 'setConfig', args: [saved] },
  ])
})

test('worker client clears tracked active builds when semantic indexing is disabled', async () => {
  const instances: FakeTransport[] = []
  const timers: Array<() => void> = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances, (method, args) => {
      if (method === 'build') return undefined
      if (method === 'buildAllPending') return undefined
      if (method === 'setConfig') return args[0]
      throw new Error(`unexpected method: ${method}`)
    }),
    idleTimeoutMs: 1000,
    timers: {
      setTimeout(callback) {
        timers.push(callback)
        return callback
      },
      clearTimeout() {
        /* test timer is manually triggered */
      },
    },
  })

  await client.build('session-a')
  await client.buildAllPending()
  const initial = await client.getConfig()
  await client.setConfig({ ...initial, enabled: false })

  assert.equal(timers.length, 1)
  timers.shift()?.()
  assert.equal(instances[0].closed, true)
})

test('worker client does not clear active-build state from partial status snapshots', async () => {
  const instances: FakeTransport[] = []
  const timers: Array<() => void> = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances, (method) => {
      if (method === 'listEnabledStatuses') return [makeStatus('session-a', true)]
      if (method === 'status') return makeStatus('session-b', false)
      throw new Error(`unexpected method: ${method}`)
    }),
    idleTimeoutMs: 1000,
    timers: {
      setTimeout(callback) {
        timers.push(callback)
        return callback
      },
      clearTimeout() {
        /* test timer is manually triggered */
      },
    },
  })

  await client.listEnabledStatuses()
  await client.status('session-b')

  assert.equal(timers.length, 0)
})

test('worker client clears session active-build state from matching status snapshots', async () => {
  const instances: FakeTransport[] = []
  const timers: Array<() => void> = []
  const client = createSemanticIndexWorkerClient({
    configStore: makeConfigStore(),
    transportFactory: makeFactory(instances, (method, args) => {
      if (method === 'build') return undefined
      if (method === 'status') return makeStatus(args[0] as string, false)
      throw new Error(`unexpected method: ${method}`)
    }),
    idleTimeoutMs: 1000,
    timers: {
      setTimeout(callback) {
        timers.push(callback)
        return callback
      },
      clearTimeout() {
        /* test timer is manually triggered */
      },
    },
  })

  await client.build('session-a')
  await client.status('session-a')

  assert.equal(timers.length, 1)
  timers.shift()?.()
  assert.equal(instances[0].closed, true)
})
