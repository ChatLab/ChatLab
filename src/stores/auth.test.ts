import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'

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

test('keeps authentication required after rejected credentials and allows a later login', () => {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: createMemoryStorage() },
    sessionStorage: { configurable: true, value: createMemoryStorage() },
  })
  setActivePinia(createPinia())

  const auth = useAuthStore()
  auth.login('expired-token', false)
  auth.requireLogin()

  assert.equal(auth.token, '')
  assert.equal(auth.isAuthenticated, false)
  assert.equal(auth.requiresAuth, true)
  assert.equal(sessionStorage.getItem('chatlab_auth_token'), null)

  auth.login('valid-token', false)
  assert.equal(auth.isAuthenticated, true)
  assert.equal(auth.requiresAuth, true)
})
