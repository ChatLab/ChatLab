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
import { buildRelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'

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

test('derives stable shallow 3D depth from existing graph nodes', () => {
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
    assert.ok(item.z >= -800 && item.z <= 800)
    assert.ok(item.radius >= 1.5)
  }

  const alice = scene.nodes.find((item) => item.key === 'weixin:alice')
  const reversedAlice = reversedScene.nodes.find((item) => item.key === 'weixin:alice')
  assert.equal(alice?.z, reversedAlice?.z)
})

test('highlights selected node neighbors and dims unrelated nodes', () => {
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
  const owner = scene.nodes.find((item) => item.node.kind === 'owner')

  assert.equal(owner?.x, 0)
  assert.equal(owner?.y, 0)
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
})

test('keeps labels sparse while preserving selected and high-visibility names', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:selected', rank: 18, labelVisibility: 0 }),
      node({ key: 'weixin:important', rank: 20, labelVisibility: 2 }),
      node({ key: 'weixin:quiet', rank: 240, labelVisibility: 0 }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:selected' })

  assert.equal(scene.nodes.find((item) => item.key === 'weixin:selected')?.labelTier, 2)
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:important')?.labelTier, 2)
  assert.equal(scene.nodes.find((item) => item.key === 'weixin:quiet')?.labelTier, 0)
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

  const scene = buildRelationshipGalaxy3DScene(graph, { selectedKey: 'weixin:owner' })
  const owner = scene.nodes.find((item) => item.key === 'weixin:owner')
  const friend = scene.nodes.find((item) => item.key === 'weixin:friend')
  const groupmate = scene.nodes.find((item) => item.key === 'weixin:groupmate')

  assert.equal(owner?.color, 0xfff2a8)
  assert.ok((friend?.color ?? 0) !== 0x2563eb)
  assert.ok((groupmate?.color ?? 0) !== 0x22d3ee)
  assert.ok(new Set(scene.nodes.map((item) => item.color)).size >= 3)
  assert.ok((owner?.radius ?? 0) > (groupmate?.radius ?? 0) * 2)
  assert.equal(Object.hasOwn(owner ?? {}, 'glow'), false)
  assert.equal(Object.hasOwn(groupmate ?? {}, 'glow'), false)
})

test('uses stellar temperature colors instead of saturated rainbow node colors', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'weixin:owner', kind: 'owner', rank: 1, pool: 'friend', score: 1 }),
      node({ key: 'weixin:warm', rank: 2, pool: 'friend', score: 0.9 }),
      node({ key: 'weixin:cool', rank: 30, pool: 'non_friend', score: 0.45 }),
    ],
    edges: [],
    communities: [],
  }

  const scene = buildRelationshipGalaxy3DScene(graph)
  const oldRainbowColors = new Set([0xb7ff72, 0xff9bd8, 0x67f4a8, 0xb9b4ff, 0xd7ff8a])

  assert.equal(
    scene.nodes.some((item) => oldRainbowColors.has(item.color)),
    false
  )
})
