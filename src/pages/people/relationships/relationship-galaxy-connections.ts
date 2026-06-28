import type {
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'

export interface RelationshipConnectionRankingItem {
  node: PeopleRelationshipGraphNode
  edge: PeopleRelationshipGraphEdge
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

export function buildRelationshipConnectionRanking(
  graph: PeopleRelationshipsGraphData,
  selectedKey: string | null,
  options: RelationshipConnectionRankingOptions = {}
): RelationshipConnectionRanking {
  if (!selectedKey) return { items: [], total: 0, hasMore: false }

  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]))
  const items = graph.edges
    .flatMap((edge): RelationshipConnectionRankingItem[] => {
      if (edge.sourceKey !== selectedKey && edge.targetKey !== selectedKey) return []
      const otherKey = edge.sourceKey === selectedKey ? edge.targetKey : edge.sourceKey
      const node = nodeByKey.get(otherKey)
      return node ? [{ node, edge }] : []
    })
    .sort(compareConnectionItems)

  const collapsedLimit = options.collapsedLimit ?? DEFAULT_COLLAPSED_LIMIT
  const visibleItems = options.expanded ? items : items.slice(0, collapsedLimit)

  return {
    items: visibleItems,
    total: items.length,
    hasMore: !options.expanded && items.length > collapsedLimit,
  }
}

function compareConnectionItems(a: RelationshipConnectionRankingItem, b: RelationshipConnectionRankingItem): number {
  if (b.edge.weight !== a.edge.weight) return b.edge.weight - a.edge.weight
  const bLast = b.edge.lastInteractionTs ?? 0
  const aLast = a.edge.lastInteractionTs ?? 0
  if (bLast !== aLast) return bLast - aLast
  if (a.node.rank !== b.node.rank) return a.node.rank - b.node.rank
  return a.node.key.localeCompare(b.node.key)
}
