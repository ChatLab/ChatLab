export interface FocusConnectionsActionState {
  selectedKey: string | null
  isNeighborhoodMode: boolean
  neighborhoodContactKey?: string | null
}

export function shouldShowFocusConnectionsAction(state: FocusConnectionsActionState): boolean {
  if (!state.selectedKey) return false
  if (!state.isNeighborhoodMode) return true
  return state.selectedKey !== state.neighborhoodContactKey
}
