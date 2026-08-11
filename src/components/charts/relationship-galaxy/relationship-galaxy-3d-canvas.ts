import { buildRelationshipGalaxy3DViewOffset } from './relationship-galaxy-3d-camera'
import type { RelationshipGalaxy3DNode, RelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'

/**
 * Describes only the spatial state that requires rebuilding the Three.js geometry layer.
 *
 * Selection, relationship edges, and display name changes must not affect this signature because those states can be
 * updated incrementally within the existing scene. Rebuild the scene only when node positions, colors, or community
 * glow data changes.
 */
export function buildRelationshipGalaxy3DSceneLayoutSignature(model: RelationshipGalaxy3DScene): string {
  const nodes = [...model.nodes]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((node) => [node.key, node.x, node.y, node.z, node.color, node.seed])
  const communities = [...model.communities]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((community) => [
      community.id,
      community.x,
      community.y,
      community.z,
      community.radius,
      community.color,
      community.opacity,
      community.nodeCount,
    ])

  return JSON.stringify({ nodes, communities, bounds: model.bounds })
}

export interface RelationshipGalaxyPointerPosition {
  x: number
  y: number
}

export function hasExceededRelationshipGalaxyPointerDragThreshold(
  start: RelationshipGalaxyPointerPosition,
  current: RelationshipGalaxyPointerPosition,
  threshold = 6
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

export type RelationshipGalaxyPointerClickAction = { type: 'ignore' } | { type: 'select'; key: string }

export function resolveRelationshipGalaxyPointerClickAction(
  hoveredKey: string | null,
  pointerMoved: boolean
): RelationshipGalaxyPointerClickAction {
  if (pointerMoved || !hoveredKey) return { type: 'ignore' }
  return { type: 'select', key: hoveredKey }
}

export function getRelationshipGalaxy3DDynamicLabelTier(
  sceneNode: RelationshipGalaxy3DNode,
  selectedKey: string | null,
  hoveredKey: string | null,
  selectedVisibleLabelKeys: ReadonlySet<string> | null,
  zoomLabelRankLimit = 0
): 0 | 1 | 2 {
  if (sceneNode.key === hoveredKey) return sceneNode.labelTier === 2 ? 2 : 1
  if (!selectedKey) {
    if (sceneNode.labelTier > 0) return sceneNode.labelTier
    return zoomLabelRankLimit > 0 && sceneNode.node.rank <= zoomLabelRankLimit ? 1 : 0
  }
  if (!selectedVisibleLabelKeys?.has(sceneNode.key)) return 0
  return sceneNode.key === selectedKey || sceneNode.node.visualRole === 'anchor' ? 2 : 1
}

export function getRelationshipGalaxy3DZoomLabelRankLimit(cameraDistance: number, sceneSpan: number): number {
  const normalizedDistance = cameraDistance / Math.max(1, sceneSpan)
  if (normalizedDistance < 0.34) return 32
  if (normalizedDistance < 0.48) return 16
  return 0
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
