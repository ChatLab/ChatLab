/**
 * Run: pnpm test -- src/routes/routes.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { appRoutes } from './routes'

function findRoute(path: string) {
  return appRoutes.find((route) => route.path === path)
}

test('registers people contacts as the default people child route', () => {
  const peopleRoute = findRoute('/people')

  assert.ok(peopleRoute)
  assert.deepEqual(peopleRoute.redirect, { name: 'people-contacts' })
  assert.equal(
    peopleRoute.children?.some((route) => route.path === 'contacts' && route.name === 'people-contacts'),
    true
  )
})

test('registers people relationships child route', () => {
  const peopleRoute = findRoute('/people')

  assert.ok(peopleRoute)
  assert.ok(
    peopleRoute.children?.some((route) => route.path === 'relationships' && route.name === 'people-relationships')
  )
})

test('does not keep the old contacts page route', () => {
  assert.equal(findRoute('/contacts'), undefined)
})
