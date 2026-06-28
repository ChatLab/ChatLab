/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-state.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldShowFocusConnectionsAction } from './relationship-galaxy-state'

test('shows focus connections action only after selecting a panorama node', () => {
  assert.equal(shouldShowFocusConnectionsAction({ selectedKey: null, isNeighborhoodMode: false }), false)
  assert.equal(shouldShowFocusConnectionsAction({ selectedKey: 'weixin:alice', isNeighborhoodMode: false }), true)
  assert.equal(
    shouldShowFocusConnectionsAction({
      selectedKey: 'weixin:alice',
      isNeighborhoodMode: true,
      neighborhoodContactKey: 'weixin:alice',
    }),
    false
  )
  assert.equal(
    shouldShowFocusConnectionsAction({
      selectedKey: 'weixin:bob',
      isNeighborhoodMode: true,
      neighborhoodContactKey: 'weixin:alice',
    }),
    true
  )
})
