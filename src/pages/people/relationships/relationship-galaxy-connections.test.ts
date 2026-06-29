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
import {
  buildRelationshipConnectionRanking,
  buildRelationshipVisibleGraphForSelection,
  buildRelationshipVisibleLabelKeys,
  RELATED_CONTACTS_VISIBLE_LIMIT,
} from './relationship-galaxy-connections'

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

test('adds non-normalized connection scores based on the current ranking weight', () => {
  const ranking = buildRelationshipConnectionRanking(graph(), 'owner')

  assert.equal(ranking.items[0]?.connectionScore, 12)
  assert.equal(ranking.items[1]?.connectionScore, 11)
  assert.equal(ranking.items.at(-1)?.connectionScore, 3)
})

test('expands selected node connection ranking to all visible neighbors', () => {
  const ranking = buildRelationshipConnectionRanking(graph(), 'owner', { expanded: true })

  assert.equal(ranking.total, 12)
  assert.equal(ranking.hasMore, false)
  assert.equal(ranking.items.length, 12)
})

test('builds shared top eighty visible label keys for selected relationships', () => {
  const data: PeopleRelationshipsGraphData = {
    nodes: [node('owner', 1), ...Array.from({ length: 100 }, (_, index) => node(`friend-${index + 1}`, index + 2))],
    edges: Array.from({ length: 100 }, (_, index) => edge('owner', `friend-${index + 1}`, index + 1)),
    communities: [],
  }

  const keys = buildRelationshipVisibleLabelKeys(data, 'owner')
  const ranking = buildRelationshipConnectionRanking(data, 'owner', {
    collapsedLimit: RELATED_CONTACTS_VISIBLE_LIMIT,
  })

  assert.equal(ranking.items.length, 80)
  assert.equal(keys.size, 81)
  assert.equal(keys.has('owner'), true)
  assert.equal(keys.has('friend-100'), true)
  assert.equal(keys.has('friend-20'), false)
})

test('builds selected relationship render graph from visible related contacts only', () => {
  const data: PeopleRelationshipsGraphData = {
    nodes: [node('owner', 1), ...Array.from({ length: 100 }, (_, index) => node(`friend-${index + 1}`, index + 2))],
    edges: [
      ...Array.from({ length: 100 }, (_, index) => edge('owner', `friend-${index + 1}`, index + 1)),
      edge('friend-100', 'friend-99', 500),
      edge('friend-20', 'friend-19', 500),
    ],
    communities: [],
  }

  const visibleGraph = buildRelationshipVisibleGraphForSelection(data, 'owner')
  const visibleKeys = new Set(visibleGraph.nodes.map((item) => item.key))

  assert.equal(visibleGraph.nodes.length, RELATED_CONTACTS_VISIBLE_LIMIT + 1)
  assert.equal(visibleKeys.has('owner'), true)
  assert.equal(visibleKeys.has('friend-100'), true)
  assert.equal(visibleKeys.has('friend-20'), false)
  assert.equal(
    visibleGraph.edges.every((item) => visibleKeys.has(item.sourceKey) && visibleKeys.has(item.targetKey)),
    true
  )
  assert.equal(
    visibleGraph.edges.some((item) => item.sourceKey === 'friend-100' && item.targetKey === 'friend-99'),
    true
  )
  assert.equal(
    visibleGraph.edges.some((item) => item.sourceKey === 'friend-20' || item.targetKey === 'friend-20'),
    false
  )
})

test('returns empty ranking when selected node has no direct edges', () => {
  const ranking = buildRelationshipConnectionRanking(graph(), 'missing')

  assert.equal(ranking.total, 0)
  assert.deepEqual(ranking.items, [])
})
