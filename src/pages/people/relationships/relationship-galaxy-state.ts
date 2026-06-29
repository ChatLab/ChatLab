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

export type RelationshipGalaxyPollingTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'superseded'

export interface RelationshipGalaxyTaskLike {
  status: RelationshipGalaxyPollingTaskStatus
}

export interface RelationshipGalaxyActiveTaskState<
  TGraphTask extends RelationshipGalaxyTaskLike,
  TNeighborhoodTask extends RelationshipGalaxyTaskLike,
> {
  graphTask?: TGraphTask | null
  neighborhoodTask?: TNeighborhoodTask | null
  isNeighborhoodMode: boolean
}

export function resolveRelationshipGalaxyActiveTask<
  TGraphTask extends RelationshipGalaxyTaskLike,
  TNeighborhoodTask extends RelationshipGalaxyTaskLike,
>(state: RelationshipGalaxyActiveTaskState<TGraphTask, TNeighborhoodTask>): TGraphTask | TNeighborhoodTask | null {
  if (state.neighborhoodTask?.status === 'running') return state.neighborhoodTask
  if (state.graphTask?.status === 'running') return state.graphTask
  if (state.isNeighborhoodMode && state.neighborhoodTask) return state.neighborhoodTask
  return state.graphTask ?? state.neighborhoodTask ?? null
}

export type RelationshipGalaxyPollingAction =
  | { type: 'continue-polling' }
  | { type: 'refresh-neighborhood'; key: string }
  | { type: 'stop-polling' }

export interface RelationshipGalaxyPollingState {
  previousTaskStatus?: RelationshipGalaxyPollingTaskStatus | null
  nextTaskStatus?: RelationshipGalaxyPollingTaskStatus | null
  neighborhoodContactKey?: string | null
}

export function resolveRelationshipGalaxyPollingAction(
  state: RelationshipGalaxyPollingState
): RelationshipGalaxyPollingAction {
  if (state.nextTaskStatus === 'running') return { type: 'continue-polling' }
  if (state.previousTaskStatus === 'running' && state.nextTaskStatus === 'succeeded' && state.neighborhoodContactKey) {
    return { type: 'refresh-neighborhood', key: state.neighborhoodContactKey }
  }
  return { type: 'stop-polling' }
}

export interface RelationshipGalaxyEmptyTextState {
  loadError: string
  isTaskFailed: boolean
  statusText: string
  emptyText: string
}

export function resolveRelationshipGalaxyEmptyText(state: RelationshipGalaxyEmptyTextState): string {
  if (state.loadError) return state.loadError
  if (state.isTaskFailed && state.statusText) return state.statusText
  return state.emptyText
}
