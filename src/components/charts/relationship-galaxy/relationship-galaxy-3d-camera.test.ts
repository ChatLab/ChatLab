/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-camera.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRelationshipGalaxy3DSafeArea,
  buildRelationshipGalaxy3DFocusCameraPose,
  buildRelationshipGalaxy3DFocusFrame,
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

test('flies toward the original node coordinate with a deterministic orbit angle', () => {
  const pose = buildRelationshipGalaxy3DFocusCameraPose(
    {
      position: { x: 0, y: -1000, z: 1000 },
      target: { x: 0, y: 0, z: 0 },
    },
    { x: 320, y: -180, z: 240 },
    4000,
    { orbitSeed: 0.82 }
  )

  assert.deepEqual(pose.target, { x: 320, y: -180, z: 240 })
  assert.ok(pose.position.x > pose.target.x)
  assert.ok(pose.position.y < pose.target.y)
  assert.ok(pose.position.z > pose.target.z)
  assert.ok(
    Math.abs(
      Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z) -
        1120
    ) < 0.001
  )

  const reversePose = buildRelationshipGalaxy3DFocusCameraPose(
    {
      position: { x: 0, y: -1000, z: 1000 },
      target: { x: 0, y: 0, z: 0 },
    },
    { x: 320, y: -180, z: 240 },
    4000,
    { orbitSeed: 0.18 }
  )
  assert.ok(reversePose.position.x < reversePose.target.x)
})

test('backs up enough to frame a wide selected relationship neighborhood', () => {
  const pose = buildRelationshipGalaxy3DFocusCameraPose(
    {
      position: { x: 0, y: -1000, z: 1000 },
      target: { x: 0, y: 0, z: 0 },
    },
    { x: 0, y: 0, z: 0 },
    3400,
    {
      orbitSeed: 0.5,
      focusPoints: [
        { x: 0, y: 0, z: 0 },
        { x: -900, y: 0, z: 0 },
        { x: 900, y: 0, z: 0 },
        { x: 0, y: 500, z: -500 },
      ],
      fovDegrees: 45,
      aspectRatio: 1.6,
    }
  )
  const distance = Math.hypot(pose.position.x, pose.position.y, pose.position.z)

  assert.ok(distance > 1500)
  assert.ok(distance < 1700)
})

test('centers a selected relationship neighborhood before fitting the camera', () => {
  const frame = buildRelationshipGalaxy3DFocusFrame(
    [
      { x: -800, y: -200, z: 100 },
      { x: 1200, y: 600, z: -300 },
      { x: 200, y: 100, z: 500 },
    ],
    { x: 0, y: 0, z: 0 }
  )

  assert.deepEqual(frame.target, { x: 200, y: 200, z: 100 })
})

test('keeps a distant weak relationship from pulling a dense neighborhood off center', () => {
  const corePoints = Array.from({ length: 20 }, (_, index) => ({
    x: (index - 10) * 24,
    y: ((index % 5) - 2) * 36,
    z: ((index % 4) - 2) * 28,
  }))
  const frame = buildRelationshipGalaxy3DFocusFrame([...corePoints, { x: 3000, y: 0, z: 0 }], { x: 0, y: 0, z: 0 })

  assert.ok(Math.abs(frame.target.x) < 200)
})

test('keeps dense relationship framing at a readable scale despite distant outliers', () => {
  const focusPoints = [
    ...Array.from({ length: 24 }, (_, index) => ({
      x: (index - 12) * 36,
      y: ((index % 6) - 3) * 48,
      z: ((index % 5) - 2) * 42,
    })),
    { x: 3200, y: 1800, z: -1200 },
  ]
  const pose = buildRelationshipGalaxy3DFocusCameraPose(
    {
      position: { x: 0, y: -1000, z: 1000 },
      target: { x: 0, y: 0, z: 0 },
    },
    { x: 0, y: 0, z: 0 },
    3400,
    { orbitSeed: 0.6, focusPoints, fovDegrees: 45, aspectRatio: 1.7 }
  )
  const distance = Math.hypot(pose.position.x, pose.position.y, pose.position.z)

  assert.ok(distance < 2000)
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
