import type { SessionLoadState } from '@/stores/session'

export type SidebarSessionContentState = 'loading' | 'error' | 'empty' | 'search-empty' | 'list'

export function resolveSidebarSessionContentState(input: {
  loadState: SessionLoadState
  sessionCount: number
  filteredSessionCount: number
  hasSearchQuery: boolean
}): SidebarSessionContentState {
  if (input.sessionCount === 0) {
    if (input.loadState === 'idle' || input.loadState === 'loading') return 'loading'
    if (input.loadState === 'error') return 'error'
    return 'empty'
  }

  if (input.filteredSessionCount === 0 && input.hasSearchQuery) return 'search-empty'
  return 'list'
}
