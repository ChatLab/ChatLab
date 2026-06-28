/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-camera.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRelationshipGalaxy3DFitCameraPose } from './relationship-galaxy-3d-camera'

test('fits the panorama close enough for stars and edges to be visible initially', () => {
  const pose = buildRelationshipGalaxy3DFitCameraPose({
    minX: -5000,
    maxX: 5000,
    minY: -3600,
    maxY: 3600,
    minZ: -700,
    maxZ: 700,
    width: 10000,
    height: 7200,
    depth: 1400,
  })

  const distance = Math.hypot(pose.position.x, pose.position.y, pose.position.z)

  assert.ok(distance >= 6000)
  assert.ok(distance <= 7200)
  assert.deepEqual(pose.target, { x: 0, y: 0, z: 0 })
})
