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

export interface RelationshipGalaxy3DFocusFrame {
  target: RelationshipGalaxy3DVector
}

export interface RelationshipGalaxy3DFocusCameraOptions {
  orbitSeed?: number
  focusPoints?: readonly RelationshipGalaxy3DVector[]
  fovDegrees?: number
  aspectRatio?: number
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

// The default 3D galaxy view intentionally uses tight, immersive framing.
// Edge nodes may sit near or slightly beyond the viewport instead of always being fully contained.
const IMMERSIVE_CAMERA_PADDING_SCALE = 0.9
const DENSE_FOCUS_MIN_POINTS = 9
const DENSE_FOCUS_COVERAGE = 0.9
const FOCUS_MAX_DISTANCE_SCALE = 0.48

export function buildRelationshipGalaxy3DImmersiveCameraPose(
  bounds: RelationshipGalaxy3DScene['bounds']
): RelationshipGalaxy3DCameraPose {
  const span = Math.max(bounds.width, bounds.height, bounds.depth, 900)

  return {
    position: {
      x: 0,
      y: -span * 0.5 * IMMERSIVE_CAMERA_PADDING_SCALE,
      z: span * 0.5 * IMMERSIVE_CAMERA_PADDING_SCALE,
    },
    target: { x: 0, y: 0, z: 0 },
  }
}

export function buildRelationshipGalaxy3DFocusCameraPose(
  currentPose: RelationshipGalaxy3DCameraPose,
  target: RelationshipGalaxy3DVector,
  sceneSpan: number,
  options: RelationshipGalaxy3DFocusCameraOptions = {}
): RelationshipGalaxy3DCameraPose {
  const currentViewDirection = normalizeVector(subtractVector(currentPose.position, currentPose.target))
  const normalizedSeed = clamp(options.orbitSeed ?? 0.5, 0, 1)
  const orbitDirection = normalizedSeed < 0.5 ? -1 : 1
  const orbitAngle = orbitDirection * (0.3 + Math.abs(normalizedSeed - 0.5) * 0.28)
  const rotatedDirection = rotateVectorAroundY(currentViewDirection, orbitAngle)
  const viewDirection = normalizeVector({
    ...rotatedDirection,
    y: rotatedDirection.y + (normalizedSeed - 0.5) * 0.16,
  })
  const baseDistance = clamp(sceneSpan * 0.28, 560, 1400)
  const framingDistance = deriveRelationshipGalaxy3DFramingDistance(
    options.focusPoints ?? [],
    target,
    viewDirection,
    options.fovDegrees ?? 45,
    options.aspectRatio ?? 1
  )
  const comfortableMaxDistance = clamp(sceneSpan * FOCUS_MAX_DISTANCE_SCALE, 1100, 2000)
  const distance = clamp(Math.max(baseDistance, Math.min(framingDistance, comfortableMaxDistance)), 560, 2200)

  return {
    position: addVector(target, multiplyVector(viewDirection, distance)),
    target,
  }
}

export function buildRelationshipGalaxy3DFocusFrame(
  points: readonly RelationshipGalaxy3DVector[],
  fallbackTarget: RelationshipGalaxy3DVector
): RelationshipGalaxy3DFocusFrame {
  if (points.length === 0) return { target: fallbackTarget }

  const xRange = deriveRelationshipGalaxy3DFocusRange(points.map((point) => point.x))
  const yRange = deriveRelationshipGalaxy3DFocusRange(points.map((point) => point.y))
  const zRange = deriveRelationshipGalaxy3DFocusRange(points.map((point) => point.z))
  const boundsCenter = {
    x: (xRange.min + xRange.max) / 2,
    y: (yRange.min + yRange.max) / 2,
    z: (zRange.min + zRange.max) / 2,
  }
  const selectedBias = points.length >= DENSE_FOCUS_MIN_POINTS ? 0.2 : 0
  const target = {
    x: boundsCenter.x * (1 - selectedBias) + fallbackTarget.x * selectedBias,
    y: boundsCenter.y * (1 - selectedBias) + fallbackTarget.y * selectedBias,
    z: boundsCenter.z * (1 - selectedBias) + fallbackTarget.z * selectedBias,
  }
  return { target }
}

function deriveRelationshipGalaxy3DFramingDistance(
  points: readonly RelationshipGalaxy3DVector[],
  target: RelationshipGalaxy3DVector,
  viewDirection: RelationshipGalaxy3DVector,
  fovDegrees: number,
  aspectRatio: number
): number {
  if (points.length <= 1) return 0

  const forward = multiplyVector(viewDirection, -1)
  const worldUp = Math.abs(forward.y) > 0.98 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }
  const right = normalizeVector(crossVector(forward, worldUp))
  const up = normalizeVector(crossVector(right, forward))
  const verticalTangent = Math.tan((clamp(fovDegrees, 20, 100) * Math.PI) / 360)
  const horizontalTangent = verticalTangent * clamp(aspectRatio, 0.4, 4)
  const padding = 1.1

  const requiredDistances = points.map((point) => {
    const offset = subtractVector(point, target)
    const towardCamera = dotVector(offset, viewDirection)
    const horizontalDistance = Math.abs(dotVector(offset, right))
    const verticalDistance = Math.abs(dotVector(offset, up))
    return Math.max(
      towardCamera + (horizontalDistance * padding) / horizontalTangent,
      towardCamera + (verticalDistance * padding) / verticalTangent
    )
  })
  requiredDistances.sort((a, b) => a - b)
  const coverage = points.length >= DENSE_FOCUS_MIN_POINTS ? DENSE_FOCUS_COVERAGE : 1
  const index = Math.max(0, Math.ceil(requiredDistances.length * coverage) - 1)
  return Math.max(0, requiredDistances[index] ?? 0)
}

function deriveRelationshipGalaxy3DFocusRange(values: number[]): { min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return { min: 0, max: 0 }
  const trimCount = sorted.length >= DENSE_FOCUS_MIN_POINTS ? Math.floor(sorted.length * 0.1) : 0
  return {
    min: sorted[trimCount] ?? sorted[0],
    max: sorted[sorted.length - 1 - trimCount] ?? sorted[sorted.length - 1],
  }
}

function rotateVectorAroundY(vector: RelationshipGalaxy3DVector, angle: number): RelationshipGalaxy3DVector {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: vector.x * cosine + vector.z * sine,
    y: vector.y,
    z: -vector.x * sine + vector.z * cosine,
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

function subtractVector(a: RelationshipGalaxy3DVector, b: RelationshipGalaxy3DVector): RelationshipGalaxy3DVector {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

function multiplyVector(vector: RelationshipGalaxy3DVector, scalar: number): RelationshipGalaxy3DVector {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  }
}

function crossVector(a: RelationshipGalaxy3DVector, b: RelationshipGalaxy3DVector): RelationshipGalaxy3DVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dotVector(a: RelationshipGalaxy3DVector, b: RelationshipGalaxy3DVector): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
