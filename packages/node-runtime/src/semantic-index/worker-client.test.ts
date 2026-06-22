import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SemanticIndexConfigStore } from './config'
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

  async request<T>(method: string, args: unknown[]): Promise<T> {
    this.requests.push({ method, args })
    if (method === 'status') {
      return null as T
    }
    throw new Error(`unexpected method: ${method}`)
  }

  close(): void {
    this.closed = true
  }
}

function makeFactory(instances: FakeTransport[]): SemanticIndexWorkerTransportFactory {
  return () => {
    const transport = new FakeTransport()
    instances.push(transport)
    return transport
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
