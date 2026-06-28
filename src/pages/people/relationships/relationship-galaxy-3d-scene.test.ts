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
    assert.ok(item.z >= -360 && item.z <= 360)
    assert.ok(item.radius >= item.node.size)
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
