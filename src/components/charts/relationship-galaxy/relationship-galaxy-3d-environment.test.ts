import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  RelationshipGalaxy3DEdge,
  RelationshipGalaxy3DNode,
  RelationshipGalaxy3DScene,
} from './relationship-galaxy-3d-scene'
import {
  buildRelationshipGalaxy3DAmbientParticles,
  buildRelationshipGalaxy3DFogVeils,
  selectRelationshipGalaxy3DAmbientEdgeIds,
  selectRelationshipGalaxy3DPrimarySelectedEdgeIds,
  selectRelationshipGalaxy3DSelectedEdgeIds,
} from './relationship-galaxy-3d-environment'

function createScene(nodeCount: number, edgeCount: number): RelationshipGalaxy3DScene {
  const nodes = Array.from(
    { length: nodeCount },
    (_, index): RelationshipGalaxy3DNode => ({
      key: `node-${index}`,
      node: {
        key: `node-${index}`,
        displayName: `Node ${index}`,
        avatar: null,
        score: 1,
        rank: index + 1,
        communityId: `community-${index % 4}`,
        x: 0,
        y: 0,
        size: 6,
        color: '#7dd3fc',
        labelVisibility: 0,
      },
      x: index * 10,
      y: index * 4,
      z: index * 2,
      radius: 4,
      color: 0x7dd3fc,
      state: 'normal',
      labelTier: 0,
      opacity: 0.8,
      seed: index / Math.max(1, nodeCount),
    })
  )
  const edges = Array.from(
    { length: edgeCount },
    (_, index): RelationshipGalaxy3DEdge => ({
      edge: {
        id: `edge-${index}`,
        sourceKey: nodes[index % nodeCount]?.key ?? 'node-0',
        targetKey: nodes[(index + 1) % nodeCount]?.key ?? 'node-0',
        weight: edgeCount - index,
        visibility: index % 4 === 0 ? 2 : 1,
      },
      source: nodes[index % nodeCount]!,
      target: nodes[(index + 1) % nodeCount]!,
      color: 0x7dd3fc,
      alpha: 0.1,
      width: 1,
      highlighted: index < 3,
    })
  )

  return {
    nodes,
    edges,
    communities: [],
    selectedNeighborKeys: new Set(),
    bounds: {
      minX: -1200,
      maxX: 1200,
      minY: -700,
      maxY: 700,
      minZ: -350,
      maxZ: 350,
      width: 2400,
      height: 1400,
      depth: 700,
    },
  }
}

test('builds a deterministic non-interactive ambient field around the data scene', () => {
  const scene = createScene(80, 0)
  const first = buildRelationshipGalaxy3DAmbientParticles(scene)
  const second = buildRelationshipGalaxy3DAmbientParticles(scene)

  assert.deepEqual(first, second)
  assert.ok(first.length >= 900)
  assert.ok(first.length <= 2200)
  assert.ok(first.every((particle) => particle.opacity < 0.6))
  assert.ok(first.every((particle) => particle.size <= 12))
})

test('builds restrained foreground and background fog veils around communities', () => {
  const scene = createScene(80, 0)
  scene.communities = [
    { id: 'a', x: -200, y: 100, z: 40, radius: 420, color: 0x72b8ff, opacity: 0.14, nodeCount: 50 },
    { id: 'b', x: 360, y: -120, z: -80, radius: 300, color: 0xff86ad, opacity: 0.12, nodeCount: 30 },
  ]

  const first = buildRelationshipGalaxy3DFogVeils(scene)
  const second = buildRelationshipGalaxy3DFogVeils(scene)

  assert.deepEqual(first, second)
  assert.equal(first.length, 6)
  assert.equal(
    first.some((veil) => veil.foreground),
    true
  )
  assert.equal(
    first.some((veil) => !veil.foreground),
    true
  )
  assert.equal(
    first.every((veil) => veil.opacity >= 0.026 && veil.opacity <= 0.082),
    true
  )
})

test('keeps the panorama edge hierarchy bounded while preserving the strongest relationships', () => {
  const scene = createScene(100, 500)
  const visible = selectRelationshipGalaxy3DAmbientEdgeIds(scene)

  assert.equal(visible.size, 170)
  assert.equal(visible.has('edge-0'), true)
  assert.equal(visible.has('edge-499'), false)
})

test('keeps compact filtered graphs within the same restrained ambient edge cap', () => {
  const scene = createScene(150, 500)
  const visible = selectRelationshipGalaxy3DAmbientEdgeIds(scene)

  assert.equal(visible.size, 200)
})

test('keeps only direct relationship lines in the selected overlay', () => {
  const scene = createScene(100, 120)
  const selected = selectRelationshipGalaxy3DSelectedEdgeIds(scene)
  const primary = selectRelationshipGalaxy3DPrimarySelectedEdgeIds(scene, 2)

  assert.deepEqual([...selected], ['edge-0', 'edge-1', 'edge-2'])
  assert.deepEqual([...primary], ['edge-0', 'edge-1'])
})
