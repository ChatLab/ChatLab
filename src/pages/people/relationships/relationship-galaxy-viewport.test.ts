/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-viewport.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRelationshipGalaxy2DSafeCenter,
  buildRelationshipGalaxy2DSafeFitScale,
  normalizeRelationshipGalaxySafeInsetRight,
} from './relationship-galaxy-viewport'

test('normalizes right safe inset to a useful viewport range', () => {
  assert.equal(normalizeRelationshipGalaxySafeInsetRight({ viewportWidth: 1000, safeInsetRight: -20 }), 0)
  assert.equal(normalizeRelationshipGalaxySafeInsetRight({ viewportWidth: 1000, safeInsetRight: 360 }), 360)
  assert.equal(normalizeRelationshipGalaxySafeInsetRight({ viewportWidth: 1000, safeInsetRight: 900 }), 650)
})

test('shifts 2D focus center right so the node appears left of a right-side panel', () => {
  const center = buildRelationshipGalaxy2DSafeCenter(
    { x: 100, y: 200 },
    {
      viewportWidth: 1000,
      safeInsetRight: 360,
      scale: 2,
    }
  )

  assert.deepEqual(center, { x: 190, y: 200 })
})

test('shrinks 2D fit scale for the visible area left of a right-side panel', () => {
  assert.equal(
    buildRelationshipGalaxy2DSafeFitScale(1, {
      viewportWidth: 1000,
      safeInsetRight: 360,
    }),
    0.64
  )
  assert.equal(
    buildRelationshipGalaxy2DSafeFitScale(0.5, {
      viewportWidth: 1000,
      safeInsetRight: 0,
    }),
    0.5
  )
})
