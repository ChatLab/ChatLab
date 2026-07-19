import assert from 'node:assert/strict'
import test from 'node:test'
import { webWasmRoutes } from './routes'

test('keeps Web WASM application routes independent from the backend client', () => {
  assert.deepEqual(
    webWasmRoutes.map(({ path, name }) => ({ path, name })),
    [
      { path: '/', name: 'home' },
      { path: '/group-chat/:id', name: 'group-chat' },
      { path: '/private-chat/:id', name: 'private-chat' },
    ]
  )
})
