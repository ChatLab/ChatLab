import { buildRelationshipGalaxy3DViewOffset } from './relationship-galaxy-3d-camera'
import type { RelationshipGalaxy3DNode } from './relationship-galaxy-3d-scene'

export function getRelationshipGalaxy3DDynamicLabelTier(
  sceneNode: RelationshipGalaxy3DNode,
  selectedKey: string | null,
  hoveredKey: string | null,
  selectedVisibleLabelKeys: ReadonlySet<string> | null
): 0 | 1 | 2 {
  if (sceneNode.key === hoveredKey) return sceneNode.labelTier === 2 ? 2 : 1
  if (!selectedKey) return sceneNode.labelTier
  if (!selectedVisibleLabelKeys?.has(sceneNode.key)) return 0
  return sceneNode.key === selectedKey || sceneNode.node.kind === 'owner' ? 2 : 1
}

export interface RelationshipGalaxy3DProjectionCamera {
  clearViewOffset: () => void
  setViewOffset: (
    fullWidth: number,
    fullHeight: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number
  ) => void
}

export function applyRelationshipGalaxy3DCameraViewOffset(
  camera: RelationshipGalaxy3DProjectionCamera,
  input: { viewportWidth: number; viewportHeight: number; safeInsetRight: number }
): void {
  const viewOffset = buildRelationshipGalaxy3DViewOffset(input)
  if (!viewOffset) {
    camera.clearViewOffset()
    return
  }

  camera.setViewOffset(
    viewOffset.fullWidth,
    viewOffset.fullHeight,
    viewOffset.offsetX,
    viewOffset.offsetY,
    viewOffset.width,
    viewOffset.height
  )
}

export interface RelationshipGalaxy3DCameraVector {
  x: number
  y: number
  z: number
}

export interface RelationshipGalaxy3DCameraViewState {
  kind: '3d'
  position: RelationshipGalaxy3DCameraVector
  target: RelationshipGalaxy3DCameraVector
  hasUserMovedCamera: boolean
}

export function captureRelationshipGalaxy3DCameraView(
  position: RelationshipGalaxy3DCameraVector | null | undefined,
  target: RelationshipGalaxy3DCameraVector | null | undefined,
  hasUserMovedCamera: boolean
): RelationshipGalaxy3DCameraViewState | null {
  if (!position || !target) return null
  return {
    kind: '3d',
    position: { x: position.x, y: position.y, z: position.z },
    target: { x: target.x, y: target.y, z: target.z },
    hasUserMovedCamera,
  }
}

export function parseRelationshipGalaxy3DCameraView(value: unknown): RelationshipGalaxy3DCameraViewState | null {
  if (!isRecord(value) || value.kind !== '3d' || typeof value.hasUserMovedCamera !== 'boolean') return null
  if (!isCameraVector(value.position) || !isCameraVector(value.target)) return null
  return {
    kind: '3d',
    position: value.position,
    target: value.target,
    hasUserMovedCamera: value.hasUserMovedCamera,
  }
}

function isCameraVector(value: unknown): value is RelationshipGalaxy3DCameraVector {
  if (!isRecord(value)) return false
  return (
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.z === 'number' &&
    Number.isFinite(value.z)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
