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
})
