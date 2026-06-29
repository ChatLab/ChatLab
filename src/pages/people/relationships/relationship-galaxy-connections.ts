import type {
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'

export interface RelationshipConnectionRankingItem {
  node: PeopleRelationshipGraphNode
  edge: PeopleRelationshipGraphEdge
  connectionScore: number
}

export interface RelationshipConnectionRankingOptions {
  expanded?: boolean
  collapsedLimit?: number
}

export interface RelationshipConnectionRanking {
  items: RelationshipConnectionRankingItem[]
  total: number
  hasMore: boolean
}

const DEFAULT_COLLAPSED_LIMIT = 10
export const RELATED_CONTACTS_VISIBLE_LIMIT = 80
const CONNECTION_RECENCY_HALF_LIFE_SECONDS = 120 * 24 * 60 * 60
const CONNECTION_RECENCY_FLOOR = 0.1

export interface RelationshipVisibleLabelOptions {
  limit?: number
}

export interface RelationshipVisibleGraphOptions {
  limit?: number
}

export function buildRelationshipConnectionRanking(
  graph: PeopleRelationshipsGraphData,
  selectedKey: string | null,
  options: RelationshipConnectionRankingOptions = {}
): RelationshipConnectionRanking {
  if (!selectedKey) return { items: [], total: 0, hasMore: false }

  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]))
  const items = graph.edges.flatMap((edge): RelationshipConnectionRankingItem[] => {
    if (edge.sourceKey !== selectedKey && edge.targetKey !== selectedKey) return []
    const otherKey = edge.sourceKey === selectedKey ? edge.targetKey : edge.sourceKey
    const node = nodeByKey.get(otherKey)
    return node ? [{ node, edge, connectionScore: 0 }] : []
  })
  const anchorTs = items.reduce((max, item) => Math.max(max, item.edge.lastInteractionTs ?? 0), 0)
  const recentWeightByItem = new Map(
    items.map((item) => [item, getRecentConnectionWeight(item.edge, anchorTs)] as const)
  )
  for (const item of items) {
    item.connectionScore = toConnectionScore(recentWeightByItem.get(item) ?? 0)
  }
  items.sort((a, b) => compareConnectionItems(a, b, anchorTs))

  const collapsedLimit = options.collapsedLimit ?? DEFAULT_COLLAPSED_LIMIT
  const visibleItems = options.expanded ? items : items.slice(0, collapsedLimit)

  return {
    items: visibleItems,
    total: items.length,
    hasMore: !options.expanded && items.length > collapsedLimit,
  }
}

export function buildRelationshipVisibleLabelKeys(
  graph: PeopleRelationshipsGraphData,
  selectedKey: string | null,
  options: RelationshipVisibleLabelOptions = {}
): Set<string> {
  const keys = new Set<string>()
  if (!selectedKey || !graph.nodes.some((node) => node.key === selectedKey)) return keys

  keys.add(selectedKey)
  const ranking = buildRelationshipConnectionRanking(graph, selectedKey, {
    collapsedLimit: options.limit ?? RELATED_CONTACTS_VISIBLE_LIMIT,
  })
  for (const item of ranking.items) keys.add(item.node.key)
  return keys
}

export function buildRelationshipVisibleGraphForSelection(
  graph: PeopleRelationshipsGraphData,
  selectedKey: string | null,
  options: RelationshipVisibleGraphOptions = {}
): PeopleRelationshipsGraphData {
  if (!selectedKey || !graph.nodes.some((node) => node.key === selectedKey)) return graph

  const visibleKeys = buildRelationshipVisibleLabelKeys(graph, selectedKey, options)
  return {
    nodes: graph.nodes.filter((node) => visibleKeys.has(node.key)),
    edges: graph.edges.filter((edge) => visibleKeys.has(edge.sourceKey) && visibleKeys.has(edge.targetKey)),
    communities: graph.communities,
  }
}

function toConnectionScore(weight: number): number {
  if (weight <= 0) return 0
  return Math.max(1, Math.round(weight))
}

function compareConnectionItems(
  a: RelationshipConnectionRankingItem,
  b: RelationshipConnectionRankingItem,
  anchorTs: number
): number {
  const bRecentWeight = getRecentConnectionWeight(b.edge, anchorTs)
  const aRecentWeight = getRecentConnectionWeight(a.edge, anchorTs)
  if (bRecentWeight !== aRecentWeight) return bRecentWeight - aRecentWeight
  if (b.edge.weight !== a.edge.weight) return b.edge.weight - a.edge.weight
  const bLast = b.edge.lastInteractionTs ?? 0
  const aLast = a.edge.lastInteractionTs ?? 0
  if (bLast !== aLast) return bLast - aLast
  if (a.node.rank !== b.node.rank) return a.node.rank - b.node.rank
  return a.node.key.localeCompare(b.node.key)
}

function getRecentConnectionWeight(edge: PeopleRelationshipGraphEdge, anchorTs: number): number {
  if (!edge.lastInteractionTs || anchorTs <= 0) return edge.weight
  const ageSeconds = Math.max(0, anchorTs - edge.lastInteractionTs)
  const recencyFactor =
    CONNECTION_RECENCY_FLOOR +
    (1 - CONNECTION_RECENCY_FLOOR) * Math.pow(0.5, ageSeconds / CONNECTION_RECENCY_HALF_LIFE_SECONDS)
  return edge.weight * recencyFactor
}
