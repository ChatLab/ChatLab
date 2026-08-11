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
  RelationshipGalaxyRenderNode,
} from '@openchatlab/shared-types'
import { buildRelationshipGalaxy3DScene, shouldRenderRelationshipGalaxy3DLabel } from './relationship-galaxy-3d-scene'

function node(
  overrides: Partial<PeopleRelationshipGraphNode> & { key: string; rank: number }
): PeopleRelationshipGraphNode & RelationshipGalaxyRenderNode {
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
    visualRole: overrides.kind === 'owner' ? 'anchor' : overrides.pool === 'friend' ? 'close' : 'standard',
    importance: overrides.kind === 'owner' ? 1 : (overrides.score ?? 0.5),
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

test('fills a volumetric panorama instead of flattening the backend 2D layout', () => {
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

  assert.ok(scene.bounds.width <= 5200)
  assert.ok(scene.bounds.height <= 3600)
  assert.ok(actualDepth > Math.max(actualWidth, actualHeight) * 0.55)
  assert.ok(scene.bounds.depth > scene.bounds.width * 0.5)
  assert.ok(scene.bounds.depth > scene.bounds.height * 0.8)
})

test('keeps every node at its panorama coordinate after selection', () => {
  const nodes = Array.from({ length: 60 }, (_, index) =>
    node({
      key: `weixin:wide-${index}`,
      rank: index + 1,
      score: Math.max(0.18, 1 - index / 70),
      communityId: `wide-community-${index % 9}`,
      pool: index < 18 ? 'friend' : 'non_friend',
    })
  )
  const edges = nodes.slice(1).map((item) => edge({ sourceKey: nodes[0].key, targetKey: item.key, weight: 1 }))
  const graph: PeopleRelationshipsGraphData = { nodes, edges, communities: [] }

  const panorama = buildRelationshipGalaxy3DScene(graph)
  const selected = buildRelationshipGalaxy3DScene(graph, { selectedKey: nodes[0].key })

  assert.ok(panorama.bounds.width > panorama.bounds.height * 1.25)
  assert.ok(panorama.bounds.depth > panorama.bounds.height * 0.9)
  assert.deepEqual(selected.bounds, panorama.bounds)
  assert.deepEqual(
    selected.nodes.map((item) => [item.key, item.x, item.y, item.z]),
    panorama.nodes.map((item) => [item.key, item.x, item.y, item.z])
  )
})

test('highlights selected node neighbors while preserving unrelated background nodes', () => {
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
  assert.equal(chen?.state, 'dimmed')
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
  const owner = scene.nodes.find((item) => item.key === 'weixin:owner')

  assert.equal(owner?.x, 0)
  assert.equal(owner?.y, 0)
  assert.equal(owner?.z, 0)
  assert.ok(scene.bounds.width <= 3600)
})

test('keeps selected contact at its original panorama position', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, score: 1, x: -1200, y: 0 }),
      node({ key: 'weixin:alice', rank: 2, score: 0.92, x: 0, y: 0 }),
      node({ key: 'weixin:bob', rank: 3, score: 0.82, x: 4800, y: 600 }),
    ],
    edges: [],
    communities: [],
  }

  const panorama = buildRelationshipGalaxy3DScene(graph)
  const selectedScene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:alice' })
  const panoramaNode = panorama.nodes.find((item) => item.key === 'weixin:alice')
  const selectedNode = selectedScene.nodes.find((item) => item.key === 'weixin:alice')

  assert.notDeepEqual([panoramaNode?.x, panoramaNode?.y, panoramaNode?.z], [0, 0, 0])
  assert.deepEqual(
    [selectedNode?.x, selectedNode?.y, selectedNode?.z],
    [panoramaNode?.x, panoramaNode?.y, panoramaNode?.z]
  )
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
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:quiet')?.labelTier, 0)
})

test('keeps the default panorama readable with at most eight persistent labels', () => {
  const nodes = Array.from({ length: 60 }, (_, index) =>
    node({
      key: `weixin:label-${index}`,
      rank: index + 1,
      score: Math.max(0.1, 1 - index / 70),
      labelVisibility: index < 30 ? 2 : 1,
      communityId: `community-${index % 5}`,
    })
  )

  const scene = buildRelationshipGalaxy3DScene({ nodes, edges: [], communities: [] })

  assert.equal(scene.nodes.filter((item) => item.labelTier > 0).length, 8)
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:label-0')?.labelTier, 2)
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:label-8')?.labelTier, 0)
})

test('limits selected relationship labels to the top twelve direct contacts', () => {
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

  assert.equal(labeledPeerKeys.length, 12)
  assert.equal(labeledPeerKeys.includes('weixin:peer-100'), true)
  assert.equal(labeledPeerKeys.includes('weixin:peer-88'), false)
})

test('preserves the complete graph while selecting a relationship node', () => {
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
  assert.equal(scene.nodes.length, nodes.length)
  assert.equal(scene.edges.length, edges.length)
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:selected')?.state, 'selected')
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:peer-100')?.state, 'neighbor')
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:peer-20')?.state, 'neighbor')
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
    shouldRenderRelationshipGalaxy3DLabel(
      scene.nodes.find((item) => item.key === 'weixin:peer-20')!,
      'weixin:selected',
      true
    ),
    false
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

test('uses restrained community colors, larger important nodes, and semantic glow fields', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, score: 1, color: '#38bdf8', communityId: 'core' }),
      node({ key: 'weixin:friend', rank: 2, pool: 'friend', score: 0.9, color: '#2563eb', communityId: 'core' }),
      node({
        key: 'weixin:groupmate',
        rank: 80,
        pool: 'non_friend',
        score: 0.2,
        color: '#22d3ee',
        communityId: 'outer',
      }),
    ],
    edges: [],
    communities: [
      { id: 'core', label: 'Core', size: 2, x: 0, y: 0, color: '#7dd3fc' },
      { id: 'outer', label: 'Outer', size: 1, x: 0, y: 0, color: '#f0abfc' },
    ],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const owner = scene.nodes.find((item) => item.key === 'weixin:owner')
  const friend = scene.nodes.find((item) => item.key === 'weixin:friend')
  const groupmate = scene.nodes.find((item) => item.key === 'weixin:groupmate')

  assert.equal(owner?.color, 0xf8fbff)
  assert.equal(friend?.color, 0x7dd3fc)
  assert.equal(groupmate?.color, 0xf0abfc)
  assert.ok(new Set(scene.nodes.map((item) => item.color)).size >= 3)
  assert.ok((owner?.radius ?? 0) > (groupmate?.radius ?? 0) * 2)
  assert.equal(scene.communities.length, 2)
  assert.ok(scene.communities.every((community) => community.radius >= 260 && community.opacity > 0))
})

test('caps high-signal node sizes so selected stars do not obscure their relationship neighborhood', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:selected', rank: 1, score: 1, size: 96 }),
      node({ key: 'weixin:peer', rank: 2, score: 0.9, size: 72 }),
    ],
    edges: [edge({ sourceKey: 'weixin:selected', targetKey: 'weixin:peer', weight: 2 })],
    communities: [],
  }

  const panorama = buildRelationshipGalaxy3DScene(graph)
  const selected = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:selected' })

  assert.ok(panorama.nodes.every((item) => item.radius <= 18))
  assert.ok(selected.nodes.find((item) => item.key === 'weixin:selected')!.radius <= 22)
  assert.ok(selected.nodes.find((item) => item.key === 'weixin:peer')!.radius <= 20)
})

test('keeps one stable color family inside each relationship community', () => {
  const colors = ['#ff86ad', '#72b8ff', '#9f8cff', '#67d9d0', '#f2c879', '#8fdaa8']
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, pool: 'friend', score: 1 }),
      ...Array.from({ length: 120 }, (_, index) =>
        node({
          key: `weixin:colorful-${index}`,
          rank: index + 2,
          communityId: `community-${index % colors.length}`,
          color: colors[index % colors.length],
          pool: index % 3 === 0 ? 'friend' : 'non_friend',
          score: Math.max(0.2, 1 - index / 80),
        })
      ),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const colorsByCommunity = new Map<string, Set<number>>()
  for (const item of scene.nodes.filter((item) => item.key !== 'weixin:owner')) {
    const communityColors = colorsByCommunity.get(item.node.communityId) ?? new Set<number>()
    communityColors.add(item.color)
    colorsByCommunity.set(item.node.communityId, communityColors)
  }

  assert.equal(colorsByCommunity.size, colors.length)
  assert.equal(
    [...colorsByCommunity.values()].every((communityColors) => communityColors.size === 1),
    true
  )
  assert.ok(new Set(scene.nodes.map((item) => item.color)).size <= colors.length + 1)
})
