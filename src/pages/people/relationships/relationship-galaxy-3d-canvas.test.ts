import assert from 'node:assert/strict'
import test from 'node:test'
import type { PeopleRelationshipGraphNode } from '@openchatlab/shared-types'
import {
  applyRelationshipGalaxy3DCameraViewOffset,
  captureRelationshipGalaxy3DCameraView,
  getRelationshipGalaxy3DDynamicLabelTier,
  parseRelationshipGalaxy3DCameraView,
} from './relationship-galaxy-3d-canvas'
import { buildRelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'

function node(key: string, rank: number, labelVisibility: 0 | 1 | 2 = 0): PeopleRelationshipGraphNode {
  return {
    key,
    kind: key === 'owner' ? 'owner' : 'contact',
    platform: 'wechat',
    platformId: key,
    sessionScoped: false,
    displayName: key,
    aliases: [],
    avatar: null,
    pool: 'friend',
    score: 1,
    rank,
    communityId: 'friends',
    x: rank * 10,
    y: rank * 5,
    size: 6,
    color: '#38bdf8',
    labelVisibility,
    lastInteractionTs: null,
    privateMessageCount: 0,
    groupMessageCount: 0,
    commonGroupCount: 1,
    searchText: key,
  }
}

test('applies and clears the 3D camera projection offset for the detail panel', () => {
  const calls: unknown[][] = []
  const camera = {
    clearViewOffset: () => calls.push(['clear']),
    setViewOffset: (...args: number[]) => calls.push(['set', ...args]),
  }

  applyRelationshipGalaxy3DCameraViewOffset(camera, {
    viewportWidth: 1000,
    viewportHeight: 500,
    safeInsetRight: 400,
  })
  applyRelationshipGalaxy3DCameraViewOffset(camera, {
    viewportWidth: 1000,
    viewportHeight: 500,
    safeInsetRight: 0,
  })

  assert.deepEqual(calls, [['set', 1400, 500, 400, 0, 1000, 500], ['clear']])
})

test('shows a temporary 3D label for a hovered node outside the persistent label tier', () => {
  const sceneNode = {
    ...buildRelationshipGalaxy3DScene({ nodes: [node('bob', 3)], edges: [], communities: [] }).nodes[0],
    labelTier: 0 as const,
  }

  assert.equal(getRelationshipGalaxy3DDynamicLabelTier(sceneNode, null, null, null), 0)
  assert.equal(getRelationshipGalaxy3DDynamicLabelTier(sceneNode, null, 'bob', null), 1)
  assert.equal(getRelationshipGalaxy3DDynamicLabelTier(sceneNode, 'owner', null, new Set(['owner'])), 0)
})

test('captures and validates a restorable 3D panorama view', () => {
  const view = captureRelationshipGalaxy3DCameraView({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, true)

  assert.deepEqual(parseRelationshipGalaxy3DCameraView(view), view)
  assert.equal(parseRelationshipGalaxy3DCameraView({ ...view, position: { x: Number.NaN, y: 2, z: 3 } }), null)
  assert.equal(captureRelationshipGalaxy3DCameraView(null, { x: 0, y: 0, z: 0 }, false), null)
})
