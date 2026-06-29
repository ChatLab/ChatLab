/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-selection.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRelationshipGalaxyCanvasSelectedKey } from './relationship-galaxy-selection'

test('defers canvas selection while the selected node neighborhood is loading', () => {
  assert.equal(
    resolveRelationshipGalaxyCanvasSelectedKey({
      selectedKey: 'contact:a',
      loadingNeighborhoodKey: 'contact:a',
      currentCanvasSelectedKey: null,
    }),
    null
  )

  assert.equal(
    resolveRelationshipGalaxyCanvasSelectedKey({
      selectedKey: 'contact:b',
      loadingNeighborhoodKey: 'contact:b',
      currentCanvasSelectedKey: 'contact:a',
    }),
    'contact:a'
  )

  assert.equal(
    resolveRelationshipGalaxyCanvasSelectedKey({
      selectedKey: 'contact:a',
      loadingNeighborhoodKey: 'contact:b',
      currentCanvasSelectedKey: null,
    }),
    'contact:a'
  )
})
