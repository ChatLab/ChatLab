export interface RelationshipGalaxyCanvasSelectionInput {
  selectedKey: string | null
  loadingNeighborhoodKey: string | null
  currentCanvasSelectedKey: string | null
}

export function resolveRelationshipGalaxyCanvasSelectedKey(
  input: RelationshipGalaxyCanvasSelectionInput
): string | null {
  if (input.selectedKey && input.selectedKey === input.loadingNeighborhoodKey) return input.currentCanvasSelectedKey
  return input.selectedKey
}
