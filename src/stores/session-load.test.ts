import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { registerAdapter } from '@/services/registry'
import type { DataAdapter } from '@/services'

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

function installMemoryStorage() {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: createMemoryStorage() },
    sessionStorage: { configurable: true, value: createMemoryStorage() },
  })
}

test('strict startup session loading preserves the retry state and rethrows data errors', async (t) => {
  installMemoryStorage()
  const failure = new Error('catalog unavailable')
  registerAdapter('data', {
    getSessions: async () => Promise.reject(failure),
  } as unknown as DataAdapter)
  setActivePinia(createPinia())
  const { useSessionStore } = await import('./session')
  const store = useSessionStore()
  t.mock.method(console, 'error', () => undefined)

  await assert.rejects(
    () => store.loadSessions({ throwOnError: true }),
    (error: unknown) => error === failure
  )
  assert.equal(store.isInitialized, false)
  assert.equal(store.loadState, 'error')
  assert.equal(store.loadError, 'catalog unavailable')
})

test('ordinary session refresh remains initialized when data loading fails', async (t) => {
  installMemoryStorage()
  registerAdapter('data', {
    getSessions: async () => Promise.reject(new Error('refresh unavailable')),
  } as unknown as DataAdapter)
  setActivePinia(createPinia())
  const { useSessionStore } = await import('./session')
  const store = useSessionStore()
  t.mock.method(console, 'error', () => undefined)

  await store.loadSessions()

  assert.equal(store.isInitialized, true)
  assert.equal(store.loadState, 'error')
})

test('session refreshes requested during an active load coalesce into one follow-up request', async () => {
  installMemoryStorage()
  let requestCount = 0
  let releaseRequest: (() => void) | undefined
  registerAdapter('data', {
    getSessions: async () => {
      const requestNumber = ++requestCount
      if (requestNumber === 1) {
        await new Promise<void>((resolve) => {
          releaseRequest = resolve
        })
      }
      return [{ id: requestNumber === 1 ? 'stale-session' : 'fresh-session' }]
    },
  } as unknown as DataAdapter)
  setActivePinia(createPinia())
  const { useSessionStore } = await import('./session')
  const store = useSessionStore()

  const first = store.loadSessions()
  const second = store.loadSessions()
  const third = store.loadSessions()
  assert.equal(requestCount, 1)
  assert.equal(store.loadState, 'loading')

  releaseRequest?.()
  await Promise.all([first, second, third])
  assert.equal(requestCount, 2)
  assert.equal(store.loadState, 'ready')
  assert.deepEqual(
    store.sessions.map((session) => session.id),
    ['fresh-session']
  )
})
