import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSidebarSessionContentState } from './session-content-state'

test('sidebar only blocks session content while the initial empty catalog is loading or failed', () => {
  assert.equal(
    resolveSidebarSessionContentState({
      loadState: 'loading',
      sessionCount: 0,
      filteredSessionCount: 0,
      hasSearchQuery: false,
    }),
    'loading'
  )
  assert.equal(
    resolveSidebarSessionContentState({
      loadState: 'error',
      sessionCount: 0,
      filteredSessionCount: 0,
      hasSearchQuery: false,
    }),
    'error'
  )
})

test('sidebar keeps an existing catalog visible during refresh and refresh failures', () => {
  for (const loadState of ['loading', 'error'] as const) {
    assert.equal(
      resolveSidebarSessionContentState({
        loadState,
        sessionCount: 3,
        filteredSessionCount: 3,
        hasSearchQuery: false,
      }),
      'list'
    )
  }
})
