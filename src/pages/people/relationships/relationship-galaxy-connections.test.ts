/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-connections.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'
import { buildRelationshipConnectionRanking } from './relationship-galaxy-connections'

function node(key: string, rank: number): PeopleRelationshipGraphNode {
  return {
    key,
    platform: 'weixin',
    platformId: key,
    sessionScoped: false,
    displayName: key,
    aliases: [],
    avatar: null,
    pool: 'non_friend',
    score: 1,
    rank,
    communityId: 'group-a',
    x: 0,
    y: 0,
    size: 4,
    color: '#7dd3fc',
    labelVisibility: 0,
    lastInteractionTs: null,
    privateMessageCount: 0,
    groupMessageCount: 0,
    commonGroupCount: 1,
    searchText: key,
  }
}

function edge(
  sourceKey: string,
  targetKey: string,
  weight: number,
  lastInteractionTs = 0
): PeopleRelationshipGraphEdge {
  return {
    id: `${sourceKey}:${targetKey}`,
    sourceKey,
    targetKey,
    weight,
    coOccurrenceCount: Math.round(weight),
    coOccurrenceRawScore: weight,
    replyInteractionCount: Math.floor(weight / 10),
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 0,
    sourceGroupCount: 1,
    sourceSessionIds: ['session-a'],
    lastInteractionTs,
    visibility: 1,
  }
}

function graph(): PeopleRelationshipsGraphData {
  return {
    nodes: [node('owner', 99), ...Array.from({ length: 12 }, (_, index) => node(`friend-${index + 1}`, index + 1))],
    edges: [
      ...Array.from({ length: 12 }, (_, index) => edge('owner', `friend-${index + 1}`, index + 1, index + 1)),
      edge('friend-1', 'friend-2', 999),
    ],
    communities: [],
  }
}

test('builds selected node connection ranking by edge weight', () => {
  const ranking = buildRelationshipConnectionRanking(graph(), 'owner')

  assert.equal(ranking.total, 12)
  assert.equal(ranking.hasMore, true)
  assert.deepEqual(
    ranking.items.map((item) => item.node.key),
    [
      'friend-12',
      'friend-11',
      'friend-10',
      'friend-9',
      'friend-8',
      'friend-7',
      'friend-6',
      'friend-5',
      'friend-4',
      'friend-3',
    ]
  )
  assert.equal(ranking.items[0]?.edge.weight, 12)
})

test('prefers recent selected-node connections over stale high-volume edges', () => {
  const day = 24 * 60 * 60
  const data: PeopleRelationshipsGraphData = {
    nodes: [node('owner', 1), node('recent', 2), node('stale', 3)],
    edges: [edge('owner', 'stale', 100, 100), edge('owner', 'recent', 60, 100 + day * 240)],
    communities: [],
  }

  const ranking = buildRelationshipConnectionRanking(data, 'owner', { expanded: true })

  assert.deepEqual(
    ranking.items.map((item) => item.node.key),
    ['recent', 'stale']
  )
})

test('expands selected node connection ranking to all visible neighbors', () => {
  const ranking = buildRelationshipConnectionRanking(graph(), 'owner', { expanded: true })

  assert.equal(ranking.total, 12)
  assert.equal(ranking.hasMore, false)
  assert.equal(ranking.items.length, 12)
})

test('returns empty ranking when selected node has no direct edges', () => {
  const ranking = buildRelationshipConnectionRanking(graph(), 'missing')

  assert.equal(ranking.total, 0)
  assert.deepEqual(ranking.items, [])
})
