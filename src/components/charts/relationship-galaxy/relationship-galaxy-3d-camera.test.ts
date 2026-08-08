/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-camera.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRelationshipGalaxy3DSafeArea,
  buildRelationshipGalaxy3DViewOffset,
  buildRelationshipGalaxy3DImmersiveCameraPose,
} from './relationship-galaxy-3d-camera'

test('frames the 3D panorama tightly for an immersive default view', () => {
  const pose = buildRelationshipGalaxy3DImmersiveCameraPose({
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

  assert.ok(distance >= 6200)
  assert.ok(distance <= 6600)
  assert.equal(pose.position.x, 0)
  assert.deepEqual(pose.target, { x: 0, y: 0, z: 0 })
})

test('keeps the 3D orbit target fixed while expanding camera distance for a right-side panel', () => {
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

  assert.equal(pose.position.x, 0)
  assert.equal(pose.position.y, 0)
  assert.ok(pose.position.z > 1650)
  assert.ok(pose.position.z < 1670)
  assert.deepEqual(pose.target, { x: 0, y: 0, z: 0 })
})

test('builds a 3D camera view offset that moves the focus into the visible area', () => {
  assert.deepEqual(
    buildRelationshipGalaxy3DViewOffset({
      viewportWidth: 1000,
      viewportHeight: 500,
      safeInsetRight: 400,
    }),
    {
      fullWidth: 1400,
      fullHeight: 500,
      offsetX: 400,
      offsetY: 0,
      width: 1000,
      height: 500,
    }
  )

  assert.equal(
    buildRelationshipGalaxy3DViewOffset({
      viewportWidth: 1000,
      viewportHeight: 500,
      safeInsetRight: 0,
    }),
    null
  )
})
