import assert from 'node:assert/strict'
import test from 'node:test'
import type { RelationshipGalaxyRenderNode } from '@openchatlab/shared-types'
import {
  applyRelationshipGalaxy3DCameraViewOffset,
  buildRelationshipGalaxy3DSceneLayoutSignature,
  captureRelationshipGalaxy3DCameraView,
  getRelationshipGalaxy3DDynamicLabelTier,
  getRelationshipGalaxy3DZoomLabelRankLimit,
  hasExceededRelationshipGalaxyPointerDragThreshold,
  parseRelationshipGalaxy3DCameraView,
  resolveRelationshipGalaxyPointerClickAction,
} from './relationship-galaxy-3d-canvas'
import { buildRelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'

function node(key: string, rank: number, labelVisibility: 0 | 1 | 2 = 0): RelationshipGalaxyRenderNode {
  return {
    key,
    displayName: key,
    avatar: null,
    score: 1,
    rank,
    communityId: 'friends',
    x: rank * 10,
    y: rank * 5,
    size: 6,
    color: '#38bdf8',
    labelVisibility,
    visualRole: key === 'owner' ? 'anchor' : 'close',
    importance: 1,
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

test('progressively reveals additional labels only after the user zooms into the star cloud', () => {
  const sceneNode = {
    ...buildRelationshipGalaxy3DScene({ nodes: [node('bob', 12)], edges: [], communities: [] }).nodes[0],
    labelTier: 0 as const,
  }

  assert.equal(getRelationshipGalaxy3DZoomLabelRankLimit(700, 1000), 0)
  assert.equal(getRelationshipGalaxy3DZoomLabelRankLimit(430, 1000), 16)
  assert.equal(getRelationshipGalaxy3DZoomLabelRankLimit(300, 1000), 32)
  assert.equal(getRelationshipGalaxy3DDynamicLabelTier(sceneNode, null, null, null, 16), 1)
})

test('captures and validates a restorable 3D panorama view', () => {
  const view = captureRelationshipGalaxy3DCameraView({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, true)

  assert.deepEqual(parseRelationshipGalaxy3DCameraView(view), view)
  assert.equal(parseRelationshipGalaxy3DCameraView({ ...view, position: { x: Number.NaN, y: 2, z: 3 } }), null)
  assert.equal(captureRelationshipGalaxy3DCameraView(null, { x: 0, y: 0, z: 0 }, false), null)
})

test('distinguishes an intentional canvas drag from a slightly shaky click', () => {
  const start = { x: 120, y: 80 }

  assert.equal(hasExceededRelationshipGalaxyPointerDragThreshold(start, { x: 123, y: 84 }), false)
  assert.equal(hasExceededRelationshipGalaxyPointerDragThreshold(start, { x: 132, y: 88 }), true)
})

test('keeps blank canvas clicks inert and only selects an actual node click', () => {
  assert.deepEqual(resolveRelationshipGalaxyPointerClickAction(null, false), { type: 'ignore' })
  assert.deepEqual(resolveRelationshipGalaxyPointerClickAction('alice', true), { type: 'ignore' })
  assert.deepEqual(resolveRelationshipGalaxyPointerClickAction('alice', false), { type: 'select', key: 'alice' })
})

test('keeps the 3D geometry stable while selection and relationship edges update', () => {
  const alice = node('alice', 1, 2)
  const bob = node('bob', 2, 1)
  const baseGraph = {
    nodes: [alice, bob],
    edges: [],
    communities: [{ id: 'friends', label: 'Friends', size: 2, x: 0, y: 0, color: '#38bdf8' }],
  }
  const expandedGraph = {
    ...baseGraph,
    nodes: [{ ...alice, displayName: 'Alice' }, bob],
    edges: [{ id: 'alice:bob', sourceKey: 'alice', targetKey: 'bob', weight: 1, visibility: 2 as const }],
  }

  const panoramaSignature = buildRelationshipGalaxy3DSceneLayoutSignature(buildRelationshipGalaxy3DScene(baseGraph))
  const selectedSignature = buildRelationshipGalaxy3DSceneLayoutSignature(
    buildRelationshipGalaxy3DScene(expandedGraph, { selectedKey: 'alice' })
  )

  assert.equal(selectedSignature, panoramaSignature)
})

test('requires a 3D geometry rebuild when the node layout changes', () => {
  const baseGraph = { nodes: [node('alice', 1)], edges: [], communities: [] }
  const expandedGraph = { nodes: [...baseGraph.nodes, node('bob', 2)], edges: [], communities: [] }

  assert.notEqual(
    buildRelationshipGalaxy3DSceneLayoutSignature(buildRelationshipGalaxy3DScene(baseGraph)),
    buildRelationshipGalaxy3DSceneLayoutSignature(buildRelationshipGalaxy3DScene(expandedGraph))
  )
})
