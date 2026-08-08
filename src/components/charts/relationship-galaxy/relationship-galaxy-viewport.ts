export interface RelationshipGalaxyViewportSafeAreaOptions {
  viewportWidth: number
  safeInsetRight: number
}

export interface RelationshipGalaxy2DSafeCenterOptions extends RelationshipGalaxyViewportSafeAreaOptions {
  scale: number
}

export interface RelationshipGalaxy2DPoint {
  x: number
  y: number
}

const MAX_SAFE_INSET_VIEWPORT_RATIO = 0.65

export function normalizeRelationshipGalaxySafeInsetRight(options: RelationshipGalaxyViewportSafeAreaOptions): number {
  const viewportWidth = Math.max(0, options.viewportWidth)
  if (viewportWidth <= 0) return 0
  return Math.min(Math.max(0, options.safeInsetRight), viewportWidth * MAX_SAFE_INSET_VIEWPORT_RATIO)
}

export function buildRelationshipGalaxy2DSafeCenter(
  position: RelationshipGalaxy2DPoint,
  options: RelationshipGalaxy2DSafeCenterOptions
): RelationshipGalaxy2DPoint {
  const scale = Math.max(0.001, options.scale)
  const inset = normalizeRelationshipGalaxySafeInsetRight(options)
  return {
    x: position.x + inset / 2 / scale,
    y: position.y,
  }
}

export function buildRelationshipGalaxy2DSafeFitScale(
  scale: number,
  options: RelationshipGalaxyViewportSafeAreaOptions
): number {
  const viewportWidth = Math.max(1, options.viewportWidth)
  const inset = normalizeRelationshipGalaxySafeInsetRight(options)
  const visibleWidthRatio = (viewportWidth - inset) / viewportWidth
  return Math.max(0.001, scale) * visibleWidthRatio
}
