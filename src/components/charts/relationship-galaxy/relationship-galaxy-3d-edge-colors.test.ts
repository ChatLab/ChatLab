/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-edge-colors.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { setRelationshipGalaxy3DEdgeGradientColor } from './relationship-galaxy-3d-edge-colors'

test('builds edge vertex colors as a gradient anchored to both endpoint node colors', () => {
  const source = new THREE.Color(0xffcc00)
  const target = new THREE.Color(0x00aaff)
  const start = new THREE.Color()
  const middle = new THREE.Color()
  const end = new THREE.Color()

  setRelationshipGalaxy3DEdgeGradientColor(start, source, target, 'highlight', 0)
  setRelationshipGalaxy3DEdgeGradientColor(middle, source, target, 'highlight', 0.5)
  setRelationshipGalaxy3DEdgeGradientColor(end, source, target, 'highlight', 1)

  assert.ok(start.r > end.r, 'the source endpoint should keep more of the source red/yellow tone')
  assert.ok(end.b > start.b, 'the target endpoint should keep more of the target blue tone')
  assert.ok(Math.abs(middle.r - (start.r + end.r) / 2) < 0.001)
  assert.ok(Math.abs(middle.g - (start.g + end.g) / 2) < 0.001)
  assert.ok(Math.abs(middle.b - (start.b + end.b) / 2) < 0.001)
})

test('keeps normal and dim edge gradients visually quieter than highlighted edges', () => {
  const source = new THREE.Color(0xffcc00)
  const target = new THREE.Color(0x00aaff)
  const highlighted = new THREE.Color()
  const normal = new THREE.Color()
  const dim = new THREE.Color()

  setRelationshipGalaxy3DEdgeGradientColor(highlighted, source, target, 'highlight', 0.25)
  setRelationshipGalaxy3DEdgeGradientColor(normal, source, target, 'normal', 0.25)
  setRelationshipGalaxy3DEdgeGradientColor(dim, source, target, 'dim', 0.25)

  assert.ok(normal.getHSL({ h: 0, s: 0, l: 0 }).l < highlighted.getHSL({ h: 0, s: 0, l: 0 }).l)
  assert.ok(dim.getHSL({ h: 0, s: 0, l: 0 }).l < normal.getHSL({ h: 0, s: 0, l: 0 }).l)
})

test('keeps normal edge endpoint colors distinct instead of collapsing into warm yellow', () => {
  const source = new THREE.Color(0x38bdf8)
  const target = new THREE.Color(0xf472b6)
  const start = new THREE.Color()
  const end = new THREE.Color()

  setRelationshipGalaxy3DEdgeGradientColor(start, source, target, 'normal', 0)
  setRelationshipGalaxy3DEdgeGradientColor(end, source, target, 'normal', 1)

  assert.ok(start.b - start.r > 0.2, 'the blue endpoint should still read as blue after quieting')
  assert.ok(end.r - end.g > 0.08, 'the pink endpoint should still read as pink after quieting')
})
