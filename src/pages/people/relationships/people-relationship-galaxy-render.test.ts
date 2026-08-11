import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'
import {
  buildPeopleRelationshipGalaxyRenderGraph,
  mergePeopleRelationshipGalaxyGraphs,
  resolvePeopleRelationshipGalaxyThreeCanvasGraph,
} from './people-relationship-galaxy-render'

function node(overrides: Partial<PeopleRelationshipGraphNode> & { key: string }): PeopleRelationshipGraphNode {
  return {
    key: overrides.key,
    kind: overrides.kind ?? 'contact',
    platform: 'wechat',
    platformId: overrides.key,
    sessionScoped: false,
    displayName: overrides.displayName ?? overrides.key,
    aliases: [],
    avatar: null,
    pool: overrides.pool ?? 'non_friend',
    score: overrides.score ?? 0.5,
    rank: overrides.rank ?? 1,
    communityId: 'community-a',
    x: 0,
    y: 0,
    size: 8,
    color: '#38bdf8',
    labelVisibility: 1,
    lastInteractionTs: null,
    privateMessageCount: overrides.privateMessageCount ?? 0,
    groupMessageCount: overrides.groupMessageCount ?? 0,
    commonGroupCount: 0,
    searchText: overrides.key,
  }
}

function edge(sourceKey: string, targetKey: string, weight = 1): PeopleRelationshipGraphEdge {
  return {
    id: `${sourceKey}:${targetKey}`,
    sourceKey,
    targetKey,
    weight,
    coOccurrenceCount: 1,
    coOccurrenceRawScore: weight,
    replyInteractionCount: 0,
    repliesFromSourceToTarget: 0,
    repliesFromTargetToSource: 0,
    sourceGroupCount: 1,
    sourceSessionIds: [],
    lastInteractionTs: null,
    visibility: 2,
  }
}

test('maps People-only semantics into the shared galaxy render contract', () => {
  const graph: PeopleRelationshipsGraphData = {
    nodes: [
      node({ key: 'owner', kind: 'owner', displayName: 'Private Owner' }),
      node({ key: 'alice', displayName: 'Alice', pool: 'friend', privateMessageCount: 120, score: 0.8 }),
      node({ key: 'bob', displayName: 'Bob', pool: 'non_friend', groupMessageCount: 80, score: 0.3 }),
    ],
    edges: [],
    communities: [],
  }

  const renderGraph = buildPeopleRelationshipGalaxyRenderGraph(graph, { privacyMode: true, ownerLabel: 'Me' })

  assert.equal(renderGraph.nodes[0].displayName, 'Me')
  assert.equal(renderGraph.nodes[0].visualRole, 'anchor')
  assert.equal(renderGraph.nodes[0].importance, 1)
  assert.equal(renderGraph.nodes[1].displayName, 'A***e')
  assert.equal(renderGraph.nodes[1].visualRole, 'close')
  assert.equal(renderGraph.nodes[2].visualRole, 'standard')
  assert.ok((renderGraph.nodes[1].importance ?? 0) > (renderGraph.nodes[2].importance ?? 0))
})

test('adds off-core neighborhood data without replacing panorama node coordinates', () => {
  const panoramaNode = node({ key: 'owner', kind: 'owner', displayName: 'Owner' })
  panoramaNode.x = 320
  panoramaNode.y = -180
  const offCoreNode = node({ key: 'off-core', displayName: 'Off Core' })
  const panorama: PeopleRelationshipsGraphData = {
    nodes: [panoramaNode],
    edges: [],
    communities: [{ id: 'community-a', label: 'A', size: 1, x: 0, y: 0, color: '#38bdf8' }],
  }
  const neighborhood: PeopleRelationshipsGraphData = {
    nodes: [{ ...panoramaNode, x: 0, y: 0 }, offCoreNode],
    edges: [edge('owner', 'off-core')],
    communities: [],
  }

  const merged = mergePeopleRelationshipGalaxyGraphs(panorama, neighborhood)

  assert.equal(merged.nodes.length, 2)
  assert.deepEqual(
    merged.nodes.find((item) => item.key === 'owner'),
    panoramaNode
  )
  assert.equal(merged.edges.length, 1)
  assert.equal(merged.communities.length, 1)

  assert.equal(
    resolvePeopleRelationshipGalaxyThreeCanvasGraph({
      panorama,
      neighborhood,
      selectedKey: 'owner',
    }).nodes.length,
    2
  )
  assert.equal(
    resolvePeopleRelationshipGalaxyThreeCanvasGraph({
      panorama,
      neighborhood,
      selectedKey: 'off-core',
    }).nodes.length,
    2
  )
})

test('keeps every selected neighborhood connection instead of the panorama per-node edge subset', () => {
  const owner = node({ key: 'owner', kind: 'owner', displayName: 'Owner' })
  owner.x = 320
  owner.y = -180
  const contacts = Array.from({ length: 79 }, (_, index) => node({ key: `contact-${index}` }))
  const neighborhoodEdges = contacts.map((contact, index) => edge('owner', contact.key, 100 - index))
  const panorama: PeopleRelationshipsGraphData = {
    nodes: [owner, ...contacts],
    edges: neighborhoodEdges.slice(0, 12),
    communities: [],
  }
  const neighborhood: PeopleRelationshipsGraphData = {
    nodes: [{ ...owner, x: 0, y: 0 }, ...contacts],
    edges: neighborhoodEdges,
    communities: [],
  }

  const resolved = resolvePeopleRelationshipGalaxyThreeCanvasGraph({
    panorama,
    neighborhood,
    selectedKey: owner.key,
  })

  assert.equal(resolved.edges.filter((item) => item.sourceKey === owner.key).length, 79)
  assert.equal(resolved.nodes.length, 80)
  assert.equal(
    resolved.nodes.find((item) => item.key === owner.key),
    owner
  )
})
