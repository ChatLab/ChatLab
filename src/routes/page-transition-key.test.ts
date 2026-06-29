/**
 * Run: pnpm test -- src/routes/page-transition-key.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePageTransitionKey } from './page-transition-key'

test('keeps people child routes under one page transition key', () => {
  const contactsKey = resolvePageTransitionKey({
    matched: [{ path: '/people' }, { path: 'contacts' }],
    params: {},
  })
  const relationshipsKey = resolvePageTransitionKey({
    matched: [{ path: '/people' }, { path: 'relationships' }],
    params: {},
  })

  assert.equal(contactsKey, '/people')
  assert.equal(relationshipsKey, '/people')
})

test('keeps dynamic session id in page transition key', () => {
  assert.equal(
    resolvePageTransitionKey({
      matched: [{ path: '/private-chat/:id' }],
      params: { id: 'session-a' },
    }),
    '/private-chat/:id:session-a'
  )
})
