import type { RelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'
import { normalizeRelationshipGalaxySafeInsetRight } from './relationship-galaxy-viewport'

export interface RelationshipGalaxy3DVector {
  x: number
  y: number
  z: number
}

export interface RelationshipGalaxy3DCameraPose {
  position: RelationshipGalaxy3DVector
  target: RelationshipGalaxy3DVector
}

export interface RelationshipGalaxy3DSafeAreaOptions {
  viewportWidth: number
  viewportHeight: number
  safeInsetRight: number
  fovDegrees: number
}

export interface RelationshipGalaxy3DViewOffset {
  fullWidth: number
  fullHeight: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

const FIT_CAMERA_PADDING_SCALE = 1.3

export function buildRelationshipGalaxy3DFitCameraPose(
  bounds: RelationshipGalaxy3DScene['bounds']
): RelationshipGalaxy3DCameraPose {
  const span = Math.max(bounds.width, bounds.height, bounds.depth, 900)

  return {
    position: {
      x: span * 0.3 * FIT_CAMERA_PADDING_SCALE,
      y: -span * 0.44 * FIT_CAMERA_PADDING_SCALE,
      z: span * 0.45 * FIT_CAMERA_PADDING_SCALE,
    },
    target: { x: 0, y: 0, z: 0 },
  }
}

export function applyRelationshipGalaxy3DSafeArea(
  pose: RelationshipGalaxy3DCameraPose,
  options: RelationshipGalaxy3DSafeAreaOptions
): RelationshipGalaxy3DCameraPose {
  const inset = normalizeRelationshipGalaxySafeInsetRight(options)
  const viewportWidth = Math.max(1, options.viewportWidth)
  if (inset <= 0) return pose

  const forward = normalizeVector({
    x: pose.target.x - pose.position.x,
    y: pose.target.y - pose.position.y,
    z: pose.target.z - pose.position.z,
  })
  const distance = Math.max(1, distanceBetween(pose.position, pose.target))
  // The side panel reduces usable width. Move the camera back, but keep the orbit target fixed.
  const visibleWidthRatio = Math.max(0.001, (viewportWidth - inset) / viewportWidth)
  const expandedDistance = distance / visibleWidthRatio

  return {
    position: addVector(pose.target, multiplyVector(forward, -expandedDistance)),
    target: pose.target,
  }
}

export function buildRelationshipGalaxy3DViewOffset(
  options: RelationshipGalaxyViewportViewOffsetOptions
): RelationshipGalaxy3DViewOffset | null {
  const viewportWidth = Math.max(1, Math.floor(options.viewportWidth))
  const viewportHeight = Math.max(1, Math.floor(options.viewportHeight))
  const inset = Math.floor(normalizeRelationshipGalaxySafeInsetRight(options))
  if (inset <= 0) return null

  return {
    fullWidth: viewportWidth + inset,
    fullHeight: viewportHeight,
    offsetX: inset,
    offsetY: 0,
    width: viewportWidth,
    height: viewportHeight,
  }
}

type RelationshipGalaxyViewportViewOffsetOptions = Pick<
  RelationshipGalaxy3DSafeAreaOptions,
  'viewportWidth' | 'viewportHeight' | 'safeInsetRight'
>

function addVector(a: RelationshipGalaxy3DVector, b: RelationshipGalaxy3DVector): RelationshipGalaxy3DVector {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }
}

function multiplyVector(vector: RelationshipGalaxy3DVector, scalar: number): RelationshipGalaxy3DVector {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  }
}

function distanceBetween(a: RelationshipGalaxy3DVector, b: RelationshipGalaxy3DVector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function normalizeVector(vector: RelationshipGalaxy3DVector): RelationshipGalaxy3DVector {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length <= 0) return { x: 1, y: 0, z: 0 }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}
