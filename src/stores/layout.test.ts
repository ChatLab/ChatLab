import assert from 'node:assert/strict'
import { before, beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

const storageEntries = new Map<string, string>()
const memoryStorage: Storage = {
  get length() {
    return storageEntries.size
  },
  clear() {
    storageEntries.clear()
  },
  getItem(key) {
    return storageEntries.get(key) ?? null
  },
  key(index) {
    return [...storageEntries.keys()][index] ?? null
  },
  removeItem(key) {
    storageEntries.delete(key)
  },
  setItem(key, value) {
    storageEntries.set(key, value)
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: memoryStorage,
})

let useLayoutStore: typeof import('./layout').useLayoutStore

describe('layout store app lock overlays', () => {
  before(async () => {
    ;({ useLayoutStore } = await import('./layout'))
  })

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('closes focus-trapping overlays before showing the app lock screen', () => {
    const store = useLayoutStore()
    store.showSettings = true
    store.showScreenCaptureModal = true
    store.screenCaptureImage = 'data:image/png;base64,test'
    store.showChatRecordDrawer = true
    store.chatRecordQuery = {} as never

    store.closeOverlaysForAppLock()

    assert.equal(store.showSettings, false)
    assert.equal(store.showScreenCaptureModal, false)
    assert.equal(store.screenCaptureImage, null)
    assert.equal(store.showChatRecordDrawer, false)
    assert.equal(store.chatRecordQuery, null)
  })
})
