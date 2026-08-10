/**
 * Run: pnpm test -- apps/web-wasm/src/routes.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { webWasmRoutes } from './routes'

test('registers time investment as the Web WASM insight route', () => {
  const insightRoute = webWasmRoutes.find((route) => route.path === '/insight')

  assert.ok(insightRoute)
  assert.deepEqual(insightRoute.redirect, { name: 'insight-time-investment' })
  assert.deepEqual(
    insightRoute.children?.map((route) => ({ path: route.path, name: route.name })),
    [{ path: 'time-investment', name: 'insight-time-investment' }]
  )
})
