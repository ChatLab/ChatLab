/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-edge-path.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { buildRelationshipGalaxy3DEdgeCurvePoints } from './relationship-galaxy-3d-edge-path'

test('builds a shallow curved edge path with stable endpoints', () => {
  const source = new THREE.Vector3(0, 0, 0)
  const target = new THREE.Vector3(100, 0, 0)
  const points = buildRelationshipGalaxy3DEdgeCurvePoints(source, target, 0.37)

  assert.ok(points.length > 2)
  assert.ok(points.length <= 7)
  assert.deepEqual(points[0].toArray(), source.toArray())
  assert.deepEqual(points.at(-1)?.toArray(), target.toArray())
  assert.ok(points.some((point) => Math.abs(point.y) > 0.01 || Math.abs(point.z) > 0.01))
})
