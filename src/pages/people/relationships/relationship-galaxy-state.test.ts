/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-state.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveRelationshipGalaxyActiveTask,
  resolveRelationshipGalaxyEmptyText,
  resolveRelationshipGalaxyPollingAction,
  shouldShowFocusConnectionsAction,
} from './relationship-galaxy-state'

test('shows focus connections action only after selecting a panorama node', () => {
  assert.equal(shouldShowFocusConnectionsAction({ selectedKey: null, isNeighborhoodMode: false }), false)
  assert.equal(shouldShowFocusConnectionsAction({ selectedKey: 'weixin:alice', isNeighborhoodMode: false }), true)
  assert.equal(
    shouldShowFocusConnectionsAction({
      selectedKey: 'weixin:alice',
      isNeighborhoodMode: true,
      neighborhoodContactKey: 'weixin:alice',
    }),
    false
  )
  assert.equal(
    shouldShowFocusConnectionsAction({
      selectedKey: 'weixin:bob',
      isNeighborhoodMode: true,
      neighborhoodContactKey: 'weixin:alice',
    }),
    true
  )
})

test('refreshes the open neighborhood after a polling recompute succeeds', () => {
  assert.deepEqual(
    resolveRelationshipGalaxyPollingAction({
      previousTaskStatus: 'running',
      nextTaskStatus: 'succeeded',
      neighborhoodContactKey: 'weixin:alice',
    }),
    { type: 'refresh-neighborhood', key: 'weixin:alice' }
  )

  assert.deepEqual(
    resolveRelationshipGalaxyPollingAction({
      previousTaskStatus: 'running',
      nextTaskStatus: 'running',
      neighborhoodContactKey: 'weixin:alice',
    }),
    { type: 'continue-polling' }
  )

  assert.deepEqual(
    resolveRelationshipGalaxyPollingAction({
      previousTaskStatus: 'running',
      nextTaskStatus: 'succeeded',
      neighborhoodContactKey: null,
    }),
    { type: 'stop-polling' }
  )
})

test('prefers a running neighborhood task over an older graph task while neighborhood is active', () => {
  const graphTask = { id: 'graph-old', status: 'succeeded' as const }
  const neighborhoodTask = { id: 'neighborhood-new', status: 'running' as const }
  const activeTask = resolveRelationshipGalaxyActiveTask({
    graphTask,
    neighborhoodTask,
    isNeighborhoodMode: true,
  })

  assert.equal(activeTask, neighborhoodTask)
  assert.deepEqual(
    resolveRelationshipGalaxyPollingAction({
      previousTaskStatus: activeTask?.status ?? null,
      nextTaskStatus: 'succeeded',
      neighborhoodContactKey: 'weixin:alice',
    }),
    { type: 'refresh-neighborhood', key: 'weixin:alice' }
  )
})

test('prefers failed task text over generic empty relationship graph text', () => {
  assert.equal(
    resolveRelationshipGalaxyEmptyText({
      loadError: '',
      isTaskFailed: true,
      statusText: 'people relationships worker failed',
      emptyText: 'No relationship graph data',
    }),
    'people relationships worker failed'
  )

  assert.equal(
    resolveRelationshipGalaxyEmptyText({
      loadError: 'Network request failed',
      isTaskFailed: true,
      statusText: 'people relationships worker failed',
      emptyText: 'No relationship graph data',
    }),
    'Network request failed'
  )

  assert.equal(
    resolveRelationshipGalaxyEmptyText({
      loadError: '',
      isTaskFailed: false,
      statusText: 'background state',
      emptyText: 'No relationship graph data',
    }),
    'No relationship graph data'
  )
})
