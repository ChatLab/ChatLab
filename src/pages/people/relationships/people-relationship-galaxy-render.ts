import type {
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
  RelationshipGalaxyRenderGraph,
} from '@openchatlab/shared-types'
import { getRelationshipGalaxyNodeDisplayName } from './relationship-galaxy-node-display'

export interface PeopleRelationshipGalaxyRenderOptions {
  privacyMode: boolean
  ownerLabel: string
}

export function buildPeopleRelationshipGalaxyRenderGraph(
  graph: PeopleRelationshipsGraphData,
  options: PeopleRelationshipGalaxyRenderOptions
): RelationshipGalaxyRenderGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      displayName: getRelationshipGalaxyNodeDisplayName(node, options),
      visualRole: node.kind === 'owner' ? 'anchor' : node.pool === 'friend' ? 'close' : 'standard',
      importance: computePeopleNodeImportance(node),
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    communities: graph.communities.map((community) => ({ ...community })),
  }
}

function computePeopleNodeImportance(node: PeopleRelationshipGraphNode): number {
  if (node.kind === 'owner') return 1

  const scoreImportance = clamp(node.score, 0, 1)
  const rankImportance = clamp(1 - (node.rank - 1) / 120, 0, 1)
  const privateSignal = clamp(Math.log10(node.privateMessageCount + 1) / 4, 0, 1)
  const groupSignal = clamp(Math.log10(node.groupMessageCount + 1) / 4.5, 0, 1)
  const friendBonus = node.pool === 'friend' ? 0.12 : 0
  return clamp(
    scoreImportance * 0.36 + rankImportance * 0.36 + privateSignal * 0.18 + groupSignal * 0.08 + friendBonus,
    0,
    1
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
