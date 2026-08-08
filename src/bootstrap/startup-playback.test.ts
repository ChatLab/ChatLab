import assert from 'node:assert/strict'
import test from 'node:test'
import { claimFullStartupPresentation, STARTUP_PRESENTATION_SESSION_KEY } from './startup-playback'

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

test('plays the full startup presentation only once per browsing session', () => {
  const storage = createMemoryStorage()

  assert.equal(claimFullStartupPresentation(storage), true)
  assert.equal(storage.getItem(STARTUP_PRESENTATION_SESSION_KEY), '1')
  assert.equal(claimFullStartupPresentation(storage), false)
})

test('plays the full startup presentation again in a new browsing session', () => {
  assert.equal(claimFullStartupPresentation(createMemoryStorage()), true)
  assert.equal(claimFullStartupPresentation(createMemoryStorage()), true)
})

test('keeps the full presentation when session storage is unavailable', () => {
  const unavailableStorage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: () => {
      throw new Error('storage unavailable')
    },
    setItem: () => {
      throw new Error('storage unavailable')
    },
  }

  assert.equal(claimFullStartupPresentation(unavailableStorage), true)
})
