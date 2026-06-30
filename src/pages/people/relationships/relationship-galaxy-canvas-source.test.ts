/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-canvas-source.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

function readCanvasSource(): string {
  return readFileSync(new URL('./components/RelationshipGalaxyCanvas.vue', import.meta.url), 'utf8')
}

describe('RelationshipGalaxyCanvas source', () => {
  it('uses masked relationship names for 2D privacy labels instead of rank-only labels', () => {
    const source = readCanvasSource()
    const shortName = source.slice(source.indexOf('function shortName'), source.indexOf('function getNodeColor'))

    assert.ok(shortName.includes('maskRelationshipGalaxyPrivateText(name)'))
    assert.equal(shortName.includes('`#${node.rank}`'), false)
  })
})
