/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-scene.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ChatPlatform,
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'
import { buildRelationshipGalaxy3DScene, shouldRenderRelationshipGalaxy3DLabel } from './relationship-galaxy-3d-scene'

function node(
  overrides: Partial<PeopleRelationshipGraphNode> & { key: string; rank: number }
): PeopleRelationshipGraphNode {
  return {
    key: overrides.key,
    kind: overrides.kind ?? 'contact',
    platform: 'wechat' as ChatPlatform,
    platformId: overrides.platformId ?? overrides.key,
    sessionScoped: false,
    displayName: overrides.displayName ?? overrides.key,
    aliases: [],
    avatar: null,
    pool: overrides.pool ?? 'non_friend',
    score: overrides.score ?? 0.5,
    rank: overrides.rank,
    communityId: overrides.communityId ?? 'community-a',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    size: overrides.size ?? 6,
    color: overrides.color ?? '#38bdf8',
    labelVisibility: overrides.labelVisibility ?? 0,
    lastInteractionTs: null,
    privateMessageCount: 0,
    groupMessageCount: 0,
    commonGroupCount: 0,
    searchText: overrides.searchText ?? overrides.key,
  }
}

function edge(
  overrides: Partial<PeopleRelationshipGraphEdge> & { sourceKey: string; targetKey: string }
): PeopleRelationshipGraphEdge {
  return {
    id: `${overrides.sourceKey}:${overrides.targetKey}`,
    sourceKey: overrides.sourceKey,
    targetKey: overrides.targetKey,
    weight: overrides.weight ?? 0.5,
    coOccurrenceCount: 1,
    coOccurrenceRawScore: 1,
    replyInteractionCount: 0,
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 0,
    sourceGroupCount: 1,
    sourceSessionIds: [],
    lastInteractionTs: null,
    visibility: overrides.visibility ?? 1,
  }
}

test('derives stable volumetric 3D positions from existing graph nodes', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:alice', rank: 1, score: 0.98, x: 10, y: 20, communityId: 'friends' }),
      node({ key: 'weixin:bob', rank: 2, score: 0.68, x: 60, y: -20, communityId: 'friends' }),
      node({ key: 'weixin:chen', rank: 35, score: 0.22, x: -80, y: 30, communityId: 'groupmates' }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const reversedScene = buildRelationshipGalaxy3DScene({ ...graph, nodes: [...graph.nodes].reverse() })

  assert.equal(scene.nodes.length, graph.nodes.length)
  assert.deepEqual(scene.nodes.map((item) => item.key).sort(), graph.nodes.map((item) => item.key).sort())

  for (const item of scene.nodes) {
    assert.ok(item.z >= -1800 && item.z <= 1800)
    assert.ok(item.radius >= 1.5)
  }

  const alice = scene.nodes.find((item) => item.key === 'weixin:alice')
  const reversedAlice = reversedScene.nodes.find((item) => item.key === 'weixin:alice')
  assert.deepEqual([alice?.x, alice?.y, alice?.z], [reversedAlice?.x, reversedAlice?.y, reversedAlice?.z])
})

test('fills a spherical volume instead of flattening the backend 2D layout', () => {
  const nodes = Array.from({ length: 36 }, (_, index) =>
    node({
      key: `weixin:node-${index}`,
      rank: index + 1,
      score: Math.max(0.15, 1 - index / 42),
      x: index % 2 === 0 ? -5000 : 5000,
      y: index % 3 === 0 ? -2000 : 2000,
      communityId: `community-${index % 8}`,
      pool: index < 12 ? 'friend' : 'non_friend',
    })
  )

  const scene = buildRelationshipGalaxy3DScene({ nodes, edges: [], communities: [] })
  const actualWidth = Math.max(...scene.nodes.map((item) => item.x)) - Math.min(...scene.nodes.map((item) => item.x))
  const actualHeight = Math.max(...scene.nodes.map((item) => item.y)) - Math.min(...scene.nodes.map((item) => item.y))
  const actualDepth = Math.max(...scene.nodes.map((item) => item.z)) - Math.min(...scene.nodes.map((item) => item.z))

  assert.ok(scene.bounds.width <= 3600)
  assert.ok(scene.bounds.height <= 3600)
  assert.ok(actualDepth > Math.max(actualWidth, actualHeight) * 0.55)
  assert.ok(scene.bounds.depth > scene.bounds.width * 0.8)
  assert.ok(scene.bounds.depth > scene.bounds.height * 0.8)
})

test('highlights selected node neighbors and omits unrelated nodes', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:alice', rank: 1, score: 0.92 }),
      node({ key: 'weixin:bob', rank: 2, score: 0.84 }),
      node({ key: 'weixin:chen', rank: 3, score: 0.7 }),
    ],
    edges: [edge({ sourceKey: 'weixin:alice', targetKey: 'weixin:bob', weight: 0.9, visibility: 2 })],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:alice' })
  const alice = scene.nodes.find((item) => item.key === 'weixin:alice')
  const bob = scene.nodes.find((item) => item.key === 'weixin:bob')
  const chen = scene.nodes.find((item) => item.key === 'weixin:chen')

  assert.equal(alice?.state, 'selected')
  assert.equal(bob?.state, 'neighbor')
  assert.equal(chen, undefined)
  assert.ok(scene.edges[0].highlighted)
  assert.ok(scene.edges[0].alpha > 0.3)
})

test('keeps default panorama edges visible at full view', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [node({ key: 'weixin:alice', rank: 1, score: 0.92 }), node({ key: 'weixin:bob', rank: 2, score: 0.84 })],
    edges: [edge({ sourceKey: 'weixin:alice', targetKey: 'weixin:bob', weight: 0.5, visibility: 1 })],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)

  assert.ok(scene.edges[0].alpha >= 0.055)
  assert.ok(scene.edges[0].alpha <= 0.075)
  assert.ok(scene.edges[0].width >= 0.85)
  assert.ok(scene.edges[0].width <= 1.1)
})

test('compacts wide backend layout for the 3D panorama without shrinking stars', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:left', rank: 1, score: 0.96, x: -5000, y: -900 }),
      node({ key: 'weixin:center', rank: 2, score: 0.82, x: 0, y: 0 }),
      node({ key: 'weixin:right', rank: 3, score: 0.72, x: 5000, y: 900 }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const highestRanked = scene.nodes.find((item) => item.key === 'weixin:left')

  assert.ok(scene.bounds.width <= 3600)
  assert.ok(Math.max(...scene.nodes.map((item) => Math.abs(item.x))) <= 1800)
  assert.ok((highestRanked?.radius ?? 0) > 10)
})

test('keeps owner at the 3D panorama center when compacting asymmetric layouts', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, score: 1, x: 0, y: 0 }),
      node({ key: 'weixin:close', rank: 2, score: 0.92, x: 220, y: 0 }),
      node({ key: 'weixin:noisy', rank: 200, score: 0.2, x: 8000, y: 400 }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const owner = scene.nodes.find((item) => item.node.kind === 'owner')

  assert.equal(owner?.x, 0)
  assert.equal(owner?.y, 0)
  assert.equal(owner?.z, 0)
  assert.ok(scene.bounds.width <= 3600)
})

test('keeps selected contact at the 3D panorama center before owner when focusing a neighborhood', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, score: 1, x: -1200, y: 0 }),
      node({ key: 'weixin:alice', rank: 2, score: 0.92, x: 0, y: 0 }),
      node({ key: 'weixin:bob', rank: 3, score: 0.82, x: 4800, y: 600 }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:alice' })
  const selected = scene.nodes.find((item) => item.key === 'weixin:alice')

  assert.equal(selected?.x, 0)
  assert.equal(selected?.y, 0)
  assert.equal(selected?.z, 0)
})

test('keeps selected labels scoped to direct relationship contacts', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:selected', rank: 18, labelVisibility: 0 }),
      node({ key: 'weixin:important', rank: 20, labelVisibility: 2 }),
      node({ key: 'weixin:quiet', rank: 240, labelVisibility: 0 }),
    ],
    edges: [edge({ sourceKey: 'weixin:selected', targetKey: 'weixin:important', weight: 2 })],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:selected' })

  assert.equal(scene.nodes.find((item) => item.key === 'weixin:selected')?.labelTier, 2)
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:important')?.labelTier, 1)
  assert.equal(
    scene.nodes.find((item) => item.key === 'weixin:quiet'),
    undefined
  )
})

test('limits selected relationship labels to the top eighty direct contacts', () => {
  const nodes = [
    node({ key: 'weixin:selected', rank: 1, labelVisibility: 0 }),
    ...Array.from({ length: 100 }, (_, index) =>
      node({
        key: `weixin:peer-${index + 1}`,
        rank: index + 100,
        labelVisibility: 0,
      })
    ),
  ]
  const edges = Array.from({ length: 100 }, (_, index) =>
    edge({
      sourceKey: 'weixin:selected',
      targetKey: `weixin:peer-${index + 1}`,
      weight: index + 1,
    })
  )

  const scene = buildRelationshipGalaxy3DScene({ nodes, edges, communities: [] }, { selectedKey: 'weixin:selected' })
  const labeledPeerKeys = scene.nodes
    .filter((item) => item.key !== 'weixin:selected' && item.labelTier > 0)
    .map((item) => item.key)

  assert.equal(labeledPeerKeys.length, 80)
  assert.equal(labeledPeerKeys.includes('weixin:peer-100'), true)
  assert.equal(labeledPeerKeys.includes('weixin:peer-20'), false)
})

test('renders only selected and visible related contacts in selected 3D scene', () => {
  const nodes = [
    node({ key: 'weixin:selected', rank: 1, labelVisibility: 0 }),
    ...Array.from({ length: 100 }, (_, index) =>
      node({
        key: `weixin:peer-${index + 1}`,
        rank: index + 100,
        labelVisibility: 0,
      })
    ),
  ]
  const edges = [
    ...Array.from({ length: 100 }, (_, index) =>
      edge({
        sourceKey: 'weixin:selected',
        targetKey: `weixin:peer-${index + 1}`,
        weight: index + 1,
      })
    ),
    edge({ sourceKey: 'weixin:peer-100', targetKey: 'weixin:peer-99', weight: 500 }),
    edge({ sourceKey: 'weixin:peer-20', targetKey: 'weixin:peer-19', weight: 500 }),
  ]

  const scene = buildRelationshipGalaxy3DScene({ nodes, edges, communities: [] }, { selectedKey: 'weixin:selected' })
  const visibleKeys = new Set(scene.nodes.map((item) => item.key))

  assert.equal(scene.nodes.length, 81)
  assert.equal(visibleKeys.has('weixin:selected'), true)
  assert.equal(visibleKeys.has('weixin:peer-100'), true)
  assert.equal(visibleKeys.has('weixin:peer-20'), false)
  assert.equal(
    scene.edges.every((item) => visibleKeys.has(item.edge.sourceKey) && visibleKeys.has(item.edge.targetKey)),
    true
  )
  assert.equal(
    scene.edges.some((item) => item.edge.sourceKey === 'weixin:peer-100' && item.edge.targetKey === 'weixin:peer-99'),
    true
  )
})

test('keeps rendered selected relationship labels aligned with the scene label tier', () => {
  const nodes = [
    node({ key: 'weixin:selected', rank: 1, labelVisibility: 0 }),
    ...Array.from({ length: 100 }, (_, index) =>
      node({
        key: `weixin:peer-${index + 1}`,
        rank: index + 100,
        labelVisibility: 2,
      })
    ),
  ]
  const edges = Array.from({ length: 100 }, (_, index) =>
    edge({
      sourceKey: 'weixin:selected',
      targetKey: `weixin:peer-${index + 1}`,
      weight: index + 1,
    })
  )

  const scene = buildRelationshipGalaxy3DScene({ nodes, edges, communities: [] }, { selectedKey: 'weixin:selected' })

  assert.equal(
    shouldRenderRelationshipGalaxy3DLabel(
      scene.nodes.find((item) => item.key === 'weixin:selected')!,
      'weixin:selected',
      false
    ),
    true
  )
  assert.equal(
    shouldRenderRelationshipGalaxy3DLabel(
      scene.nodes.find((item) => item.key === 'weixin:peer-100')!,
      'weixin:selected',
      true
    ),
    true
  )
  assert.equal(
    scene.nodes.find((item) => item.key === 'weixin:peer-20'),
    undefined
  )
})

test('renders selected-scene related labels from label tier even without recomputed neighbor state', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:selected', rank: 1, labelVisibility: 0 }),
      node({ key: 'weixin:peer', rank: 2, labelVisibility: 0 }),
    ],
    edges: [edge({ sourceKey: 'weixin:selected', targetKey: 'weixin:peer', weight: 2 })],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:selected' })
  const peer = scene.nodes.find((item) => item.key === 'weixin:peer')!

  assert.equal(peer.labelTier, 1)
  assert.equal(shouldRenderRelationshipGalaxy3DLabel(peer, 'weixin:selected', false), true)
})

test('uses varied node colors, larger important nodes, and no glow field', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, score: 1, color: '#38bdf8' }),
      node({ key: 'weixin:friend', rank: 2, pool: 'friend', score: 0.9, color: '#2563eb' }),
      node({ key: 'weixin:groupmate', rank: 80, pool: 'non_friend', score: 0.2, color: '#22d3ee' }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const owner = scene.nodes.find((item) => item.key === 'weixin:owner')
  const friend = scene.nodes.find((item) => item.key === 'weixin:friend')
  const groupmate = scene.nodes.find((item) => item.key === 'weixin:groupmate')

  assert.equal(owner?.color, 0xf8fbff)
  assert.ok((friend?.color ?? 0) !== 0x2563eb)
  assert.ok((groupmate?.color ?? 0) !== 0x22d3ee)
  assert.ok(new Set(scene.nodes.map((item) => item.color)).size >= 3)
  assert.ok((owner?.radius ?? 0) > (groupmate?.radius ?? 0) * 2)
  assert.equal(Object.hasOwn(owner ?? {}, 'glow'), false)
  assert.equal(Object.hasOwn(groupmate ?? {}, 'glow'), false)
})

test('uses a broad deterministic multi-color palette for contact stars', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, pool: 'friend', score: 1 }),
      ...Array.from({ length: 120 }, (_, index) =>
        node({
          key: `weixin:colorful-${index}`,
          rank: index + 2,
          pool: index % 3 === 0 ? 'friend' : 'non_friend',
          score: Math.max(0.2, 1 - index / 80),
        })
      ),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const contactColorFamilies = new Set(
    scene.nodes
      .filter((item) => item.node.kind !== 'owner')
      .map((item) => colorFamily(item.color))
      .filter(Boolean)
  )

  assert.ok(contactColorFamilies.size >= 6)
})

function colorFamily(color: number): string | null {
  const red = ((color >> 16) & 255) / 255
  const green = ((color >> 8) & 255) / 255
  const blue = (color & 255) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (delta < 0.18) return null

  let hue = 0
  if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60
  else if (max === green) hue = ((blue - red) / delta + 2) * 60
  else hue = ((red - green) / delta + 4) * 60

  if (hue < 30 || hue >= 330) return 'rose'
  if (hue < 90) return 'gold'
  if (hue < 150) return 'green'
  if (hue < 210) return 'cyan'
  if (hue < 270) return 'blue'
  return 'violet'
}
