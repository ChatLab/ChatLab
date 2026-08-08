import type {
  RelationshipGalaxyRenderEdge,
  RelationshipGalaxyRenderGraph,
  RelationshipGalaxyRenderNode,
} from '@openchatlab/shared-types'

export const RELATED_GALAXY_NODES_VISIBLE_LIMIT = 80
const CONNECTION_RECENCY_HALF_LIFE_SECONDS = 120 * 24 * 60 * 60
const CONNECTION_RECENCY_FLOOR = 0.1

export interface RelationshipVisibleLabelOptions {
  limit?: number
}

export interface RelationshipVisibleGraphOptions {
  limit?: number
}

export function buildRelationshipVisibleLabelKeys(
  graph: RelationshipGalaxyRenderGraph,
  selectedKey: string | null,
  options: RelationshipVisibleLabelOptions = {}
): Set<string> {
  const keys = new Set<string>()
  if (!selectedKey || !graph.nodes.some((node) => node.key === selectedKey)) return keys

  keys.add(selectedKey)
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]))
  const anchorTs = graph.edges.reduce((max, edge) => {
    if (edge.sourceKey !== selectedKey && edge.targetKey !== selectedKey) return max
    return Math.max(max, edge.lastInteractionTs ?? 0)
  }, 0)
  const related = graph.edges
    .flatMap((edge): Array<{ node: RelationshipGalaxyRenderNode; edge: RelationshipGalaxyRenderEdge }> => {
      if (edge.sourceKey !== selectedKey && edge.targetKey !== selectedKey) return []
      const otherKey = edge.sourceKey === selectedKey ? edge.targetKey : edge.sourceKey
      const node = nodeByKey.get(otherKey)
      return node ? [{ node, edge }] : []
    })
    .sort((a, b) => compareRelatedNodes(a, b, anchorTs))
    .slice(0, options.limit ?? RELATED_GALAXY_NODES_VISIBLE_LIMIT)

  for (const item of related) keys.add(item.node.key)
  return keys
}

export function buildRelationshipVisibleGraphForSelection(
  graph: RelationshipGalaxyRenderGraph,
  selectedKey: string | null,
  options: RelationshipVisibleGraphOptions = {}
): RelationshipGalaxyRenderGraph {
  if (!selectedKey || !graph.nodes.some((node) => node.key === selectedKey)) return graph

  const visibleKeys = buildRelationshipVisibleLabelKeys(graph, selectedKey, options)
  return {
    nodes: graph.nodes.filter((node) => visibleKeys.has(node.key)),
    edges: graph.edges.filter((edge) => visibleKeys.has(edge.sourceKey) && visibleKeys.has(edge.targetKey)),
    communities: graph.communities,
  }
}

function compareRelatedNodes(
  a: { node: RelationshipGalaxyRenderNode; edge: RelationshipGalaxyRenderEdge },
  b: { node: RelationshipGalaxyRenderNode; edge: RelationshipGalaxyRenderEdge },
  anchorTs: number
): number {
  const recentWeightDiff = getRecentConnectionWeight(b.edge, anchorTs) - getRecentConnectionWeight(a.edge, anchorTs)
  return (
    recentWeightDiff ||
    b.edge.weight - a.edge.weight ||
    (b.edge.lastInteractionTs ?? 0) - (a.edge.lastInteractionTs ?? 0) ||
    a.node.rank - b.node.rank ||
    a.node.key.localeCompare(b.node.key)
  )
}

function getRecentConnectionWeight(edge: RelationshipGalaxyRenderEdge, anchorTs: number): number {
  if (!edge.lastInteractionTs || anchorTs <= 0) return edge.weight
  const ageSeconds = Math.max(0, anchorTs - edge.lastInteractionTs)
  const recencyFactor =
    CONNECTION_RECENCY_FLOOR +
    (1 - CONNECTION_RECENCY_FLOOR) * Math.pow(0.5, ageSeconds / CONNECTION_RECENCY_HALF_LIFE_SECONDS)
  return edge.weight * recencyFactor
}
