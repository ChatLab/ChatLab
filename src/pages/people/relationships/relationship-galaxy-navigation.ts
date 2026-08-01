export type RelationshipGalaxyViewMode = '3d' | '2d'

export const DEFAULT_RELATIONSHIP_GALAXY_VIEW_MODE: RelationshipGalaxyViewMode = '3d'

export interface RelationshipGalaxyCanvasViewController {
  fitView: () => void
  captureView: () => unknown | null
  restoreView: (view: unknown) => boolean
}

export function resolveRelationshipGalaxyFallbackViewMode(
  currentMode: RelationshipGalaxyViewMode
): RelationshipGalaxyViewMode {
  return currentMode === '3d' ? '2d' : currentMode
}

export function captureRelationshipGalaxyPanoramaView(
  canvas: RelationshipGalaxyCanvasViewController | null,
  selectedKey: string | null,
  savedView: unknown | null
): unknown | null {
  if (selectedKey || savedView) return savedView
  return canvas?.captureView() ?? null
}

export function restoreRelationshipGalaxyPanoramaView(
  canvas: RelationshipGalaxyCanvasViewController | null,
  savedView: unknown | null
): boolean {
  if (savedView && canvas?.restoreView(savedView) === true) return true
  canvas?.fitView()
  return false
}
