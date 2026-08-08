import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupRelationshipGalaxyData } from '@openchatlab/shared-types'
import {
  buildGroupRelationshipGalaxyConnections,
  resolveGroupRelationshipGalaxyDisplayState,
} from './group-relationship-galaxy-view'

const data = {
  members: [
    { key: 'a', rank: 1 },
    { key: 'b', rank: 2 },
    { key: 'c', rank: 3 },
  ],
  edges: [
    { id: 'a-c', sourceKey: 'a', targetKey: 'c', weight: 2, lastInteractionTs: 200 },
    { id: 'a-b', sourceKey: 'b', targetKey: 'a', weight: 5, lastInteractionTs: 100 },
    { id: 'b-c', sourceKey: 'b', targetKey: 'c', weight: 8, lastInteractionTs: 300 },
  ],
} as GroupRelationshipGalaxyData

test('builds the selected relationship member connection list from either edge direction', () => {
  const connections = buildGroupRelationshipGalaxyConnections(data, 'a')

  assert.deepEqual(
    connections.map((item) => [item.member.key, item.edge.id]),
    [
      ['b', 'a-b'],
      ['c', 'a-c'],
    ]
  )
})

test('limits the detail list without including unrelated strong edges', () => {
  assert.deepEqual(
    buildGroupRelationshipGalaxyConnections(data, 'a', 1).map((item) => item.member.key),
    ['b']
  )
  assert.deepEqual(buildGroupRelationshipGalaxyConnections(data, null), [])
})

test('keeps the existing galaxy canvas mounted while a new time range is loading', () => {
  assert.deepEqual(
    resolveGroupRelationshipGalaxyDisplayState({
      isLoading: true,
      hasGraph: true,
      hasError: false,
      webglUnavailable: false,
    }),
    { content: 'canvas', showLoadingOverlay: true }
  )
})

test('uses the page loading state when no galaxy has been rendered yet', () => {
  assert.deepEqual(
    resolveGroupRelationshipGalaxyDisplayState({
      isLoading: true,
      hasGraph: false,
      hasError: false,
      webglUnavailable: false,
    }),
    { content: 'loading', showLoadingOverlay: false }
  )
})
