import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
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

function createPersistedPinia(storage: Storage) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  const pinia = createPinia().use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

test('layout persistence upgrades older state and restores a saved drawer width', async () => {
  const storage = createMemoryStorage({ layout: JSON.stringify({ isSidebarCollapsed: true }) })
  const legacyPinia = createPersistedPinia(storage)
  const { useLayoutStore } = await import('./layout')
  const legacyStore = useLayoutStore(legacyPinia)

  assert.equal(legacyStore.isSidebarCollapsed, true)
  assert.equal(legacyStore.chatRecordDrawerWidth, 750)

  storage.setItem('layout', JSON.stringify({ chatRecordDrawerWidth: 936 }))
  const restoredPinia = createPersistedPinia(storage)
  const restoredStore = useLayoutStore(restoredPinia)

  assert.equal(restoredStore.chatRecordDrawerWidth, 936)
})
