/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-camera.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRelationshipGalaxy3DSafeArea,
  buildRelationshipGalaxy3DFitCameraPose,
} from './relationship-galaxy-3d-camera'

test('fits the panorama with enough padding for a selected relationship network', () => {
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

  assert.ok(distance >= 8700)
  assert.ok(distance <= 9800)
  assert.ok(Math.abs(pose.position.x) > 1000)
  assert.deepEqual(pose.target, { x: 0, y: 0, z: 0 })
})

test('shifts and expands 3D camera pose so the focused node network fits left of a right-side panel', () => {
  const pose = applyRelationshipGalaxy3DSafeArea(
    {
      position: { x: 0, y: 0, z: 1000 },
      target: { x: 0, y: 0, z: 0 },
    },
    {
      viewportWidth: 1000,
      viewportHeight: 500,
      safeInsetRight: 400,
      fovDegrees: 60,
    }
  )

  assert.ok(pose.position.x > 769)
  assert.ok(pose.position.x < 771)
  assert.equal(pose.position.y, 0)
  assert.ok(pose.position.z > 1650)
  assert.ok(pose.position.z < 1670)
  assert.deepEqual(pose.target, { x: pose.position.x, y: 0, z: 0 })
})
