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

test('collapsing the side panel preserves the record target and reopening restores it', async () => {
  const pinia = createPersistedPinia(createMemoryStorage())
  const { useLayoutStore } = await import('./layout')
  const store = useLayoutStore(pinia)
  store.setSidePanelContext('session-a')
  store.openChatRecords({ scrollToMessageId: 42, keywords: ['hello'] })
  store.closeSidePanel()
  assert.equal(store.sidePanelOpen, false)
  assert.deepEqual(store.chatRecordQuery, { sessionId: 'session-a', scrollToMessageId: 42, keywords: ['hello'] })
  store.toggleSidePanel()
  assert.equal(store.sidePanelOpen, true)
  assert.equal(store.sidePanelView, 'records')
})

test('contact source records share one panel and can return to the selected contact', async () => {
  const pinia = createPersistedPinia(createMemoryStorage())
  const { useLayoutStore } = await import('./layout')
  const store = useLayoutStore(pinia)
  store.setSidePanelContext(null)
  store.openContactPanel()
  store.openChatRecords({ sessionId: 'contact-source', scrollToMessageId: 7 })
  assert.equal(store.sidePanelView, 'records')
  assert.equal(store.sidePanelHasContact, true)
  store.returnToSidePanel()
  assert.equal(store.sidePanelView, 'contact')
  assert.equal(store.sidePanelOpen, true)
})

test('changing page context clears stale records and opens only the new session', async () => {
  const pinia = createPersistedPinia(createMemoryStorage())
  const { useLayoutStore } = await import('./layout')
  const store = useLayoutStore(pinia)
  store.setSidePanelContext('session-a')
  store.openChatRecords({ scrollToMessageId: 42 })
  store.setSidePanelContext('session-b')
  assert.equal(store.sidePanelOpen, false)
  assert.equal(store.chatRecordQuery, null)
  store.toggleSidePanel()
  assert.deepEqual(store.chatRecordQuery, { sessionId: 'session-b' })
  store.setSidePanelContext(null)
  assert.equal(store.canOpenSidePanel, false)
  store.openChatRecords({ scrollToMessageId: 42 })
  assert.equal(store.sidePanelOpen, false)
})

test('memory context opens topics and the shared toggle restores topics after collapsing', async () => {
  const pinia = createPersistedPinia(createMemoryStorage())
  const { useLayoutStore } = await import('./layout')
  const store = useLayoutStore(pinia)
  store.setSidePanelContext('session-a', 'topics')
  assert.equal(store.sidePanelView, 'topics')
  assert.equal(store.sidePanelOpen, true)
  store.toggleSidePanel()
  assert.equal(store.sidePanelOpen, false)
  store.toggleSidePanel()
  assert.equal(store.sidePanelView, 'topics')
  assert.equal(store.sidePanelOpen, true)
  store.setSidePanelContext('session-a', 'records')
  assert.equal(store.sidePanelOpen, false)
  store.toggleSidePanel()
  assert.equal(store.sidePanelView, 'records')
  assert.deepEqual(store.chatRecordQuery, { sessionId: 'session-a' })
})

test('temporary record lookup in memory can return to topics without changing the session', async () => {
  const pinia = createPersistedPinia(createMemoryStorage())
  const { useLayoutStore } = await import('./layout')
  const store = useLayoutStore(pinia)
  store.setSidePanelContext('session-a', 'topics')
  store.openChatRecords({ memberId: 7 })
  assert.equal(store.sidePanelView, 'records')
  assert.equal(store.canReturnSidePanel, true)
  store.returnToSidePanel()
  assert.equal(store.sidePanelView, 'topics')
  assert.equal(store.sidePanelOpen, true)
  store.setSidePanelContext('session-b')
  assert.equal(store.canReturnSidePanel, false)
  assert.equal(store.chatRecordQuery, null)
})
