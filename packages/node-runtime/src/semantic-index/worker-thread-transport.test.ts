import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createSemanticIndexWorkerThreadTransport, type SemanticIndexWorkerLike } from './worker-thread-transport'

class FakeWorker extends EventEmitter implements SemanticIndexWorkerLike {
  messages: unknown[] = []
  terminated = false

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }
}

test('worker thread transport resolves matching RPC response and terminates on close', async () => {
  const worker = new FakeWorker()
  const transport = createSemanticIndexWorkerThreadTransport({
    startup: {
      paths: {
        systemDir: '/tmp/system',
        userDataDir: '/tmp/data',
        databaseDir: '/tmp/data/databases',
        vectorDir: '/tmp/data/vector',
        aiDataDir: '/tmp/system/ai',
        settingsDir: '/tmp/system/settings',
        cacheDir: '/tmp/system/cache',
        tempDir: '/tmp/system/temp',
        logsDir: '/tmp/system/logs',
        downloadsDir: '/tmp/downloads',
      },
      runtime: { version: '0.0.0-test', kind: 'cli' },
    },
    workerFactory: () => worker,
  })

  const pending = transport.request<string>('status', ['session-a'])
  const message = worker.messages[0] as { id: string; method: string; args: unknown[] }

  assert.equal(message.method, 'status')
  assert.deepEqual(message.args, ['session-a'])

  worker.emit('message', { id: message.id, success: true, result: 'ok' })

  assert.equal(await pending, 'ok')

  const closing = transport.close()
  const closeMessage = worker.messages[1] as { id: string; method: string }
  assert.equal(closeMessage.method, '__close')
  worker.emit('message', { id: closeMessage.id, success: true })
  await closing

  assert.equal(worker.terminated, true)
})

test('worker thread transport asks runtime to close before terminating worker', async () => {
  const worker = new FakeWorker()
  const transport = createSemanticIndexWorkerThreadTransport({
    startup: {
      paths: {
        systemDir: '/tmp/system',
        userDataDir: '/tmp/data',
        databaseDir: '/tmp/data/databases',
        vectorDir: '/tmp/data/vector',
        aiDataDir: '/tmp/system/ai',
        settingsDir: '/tmp/system/settings',
        cacheDir: '/tmp/system/cache',
        tempDir: '/tmp/system/temp',
        logsDir: '/tmp/system/logs',
        downloadsDir: '/tmp/downloads',
      },
      runtime: { version: '0.0.0-test', kind: 'cli' },
    },
    workerFactory: () => worker,
  })

  const closing = transport.close()
  const message = worker.messages[0] as { id: string; method: string }

  assert.equal(message.method, '__close')
  assert.equal(worker.terminated, false)

  worker.emit('message', { id: message.id, success: true })
  await closing

  assert.equal(worker.terminated, true)
})

test('worker thread transport terminates worker when runtime close does not reply', async () => {
  const worker = new FakeWorker()
  const transport = createSemanticIndexWorkerThreadTransport({
    startup: {
      paths: {
        systemDir: '/tmp/system',
        userDataDir: '/tmp/data',
        databaseDir: '/tmp/data/databases',
        vectorDir: '/tmp/data/vector',
        aiDataDir: '/tmp/system/ai',
        settingsDir: '/tmp/system/settings',
        cacheDir: '/tmp/system/cache',
        tempDir: '/tmp/system/temp',
        logsDir: '/tmp/system/logs',
        downloadsDir: '/tmp/downloads',
      },
      runtime: { version: '0.0.0-test', kind: 'cli' },
    },
    workerFactory: () => worker,
    closeTimeoutMs: 1,
  })

  await transport.close()

  const message = worker.messages[0] as { method: string }
  assert.equal(message.method, '__close')
  assert.equal(worker.terminated, true)
})
