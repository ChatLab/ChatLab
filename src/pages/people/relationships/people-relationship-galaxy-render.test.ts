import assert from 'node:assert/strict'
import test from 'node:test'
import type { PeopleRelationshipGraphNode, PeopleRelationshipsGraphData } from '@openchatlab/shared-types'
import { buildPeopleRelationshipGalaxyRenderGraph } from './people-relationship-galaxy-render'

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
