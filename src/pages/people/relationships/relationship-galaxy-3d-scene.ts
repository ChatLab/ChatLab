import type {
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'

export type RelationshipGalaxy3DNodeState = 'normal' | 'selected' | 'neighbor' | 'dimmed'

export interface RelationshipGalaxy3DNode {
  key: string
  node: PeopleRelationshipGraphNode
  x: number
  y: number
  z: number
  radius: number
  color: number
  state: RelationshipGalaxy3DNodeState
  labelTier: 0 | 1 | 2
  opacity: number
  glow: number
  seed: number
}

export interface RelationshipGalaxy3DEdge {
  edge: PeopleRelationshipGraphEdge
  source: RelationshipGalaxy3DNode
  target: RelationshipGalaxy3DNode
  color: number
  alpha: number
  width: number
  highlighted: boolean
}

export interface RelationshipGalaxy3DScene {
  nodes: RelationshipGalaxy3DNode[]
  edges: RelationshipGalaxy3DEdge[]
  selectedNeighborKeys: Set<string>
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
    width: number
    height: number
    depth: number
  }
}

export interface RelationshipGalaxy3DSceneOptions {
  selectedKey?: string | null
}

const DEFAULT_FRIEND_COLOR = 0x6ee7ff
const DEFAULT_GROUPMATE_COLOR = 0xfacc6b
const MAX_DEPTH = 360

export function buildRelationshipGalaxy3DScene(
  graph: PeopleRelationshipsGraphData,
  options: RelationshipGalaxy3DSceneOptions = {}
): RelationshipGalaxy3DScene {
  const selectedKey = options.selectedKey ?? null
  const selectedNeighborKeys = buildSelectedNeighborKeys(graph.edges, selectedKey)

  const nodes = graph.nodes.map((node) => {
    const state = resolveNodeState(node.key, selectedKey, selectedNeighborKeys)
    const seed = hashToUnit(node.key)
    const z = deriveNodeDepth(node, selectedKey, seed)
    const radius = deriveNodeRadius(node, state)
    const labelTier = deriveLabelTier(node, state, graph.nodes.length)

    return {
      key: node.key,
      node,
      x: node.x,
      y: node.y,
      z,
      radius,
      color: parseNodeColor(node),
      state,
      labelTier,
      opacity: deriveNodeOpacity(state),
      glow: deriveNodeGlow(node, state),
      seed,
    }
  })

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  const edges = graph.edges.flatMap((edge): RelationshipGalaxy3DEdge[] => {
    const source = nodeByKey.get(edge.sourceKey)
    const target = nodeByKey.get(edge.targetKey)
    if (!source || !target) return []

    const highlighted = Boolean(selectedKey && (edge.sourceKey === selectedKey || edge.targetKey === selectedKey))
    const dimmedBySelection = Boolean(selectedKey && !highlighted)
    const alpha = dimmedBySelection
      ? 0.035
      : highlighted
        ? 0.42 + Math.min(0.28, edge.weight * 0.28)
        : edge.visibility === 2
          ? 0.18
          : 0.075

    return [
      {
        edge,
        source,
        target,
        color: source.color,
        alpha,
        width: Math.min(2.2, Math.max(0.45, Math.log10(edge.weight + 1) * 1.35)),
        highlighted,
      },
    ]
  })

  return {
    nodes,
    edges,
    selectedNeighborKeys,
    bounds: deriveBounds(nodes),
  }
}

function buildSelectedNeighborKeys(edges: PeopleRelationshipGraphEdge[], selectedKey: string | null): Set<string> {
  const keys = new Set<string>()
  if (!selectedKey) return keys

  for (const edge of edges) {
    if (edge.sourceKey === selectedKey) keys.add(edge.targetKey)
    if (edge.targetKey === selectedKey) keys.add(edge.sourceKey)
  }

  return keys
}

function resolveNodeState(
  key: string,
  selectedKey: string | null,
  selectedNeighborKeys: Set<string>
): RelationshipGalaxy3DNodeState {
  if (!selectedKey) return 'normal'
  if (key === selectedKey) return 'selected'
  if (selectedNeighborKeys.has(key)) return 'neighbor'
  return 'dimmed'
}

function deriveNodeDepth(node: PeopleRelationshipGraphNode, selectedKey: string | null, seed: number): number {
  const communityDepth = hashToSignedUnit(node.communityId || 'default') * 150
  const scoreLift = (Math.max(0, Math.min(1, node.score)) - 0.5) * 110
  const rankLift = Math.max(0, 1 - (node.rank - 1) / 80) * 90
  const selectedLift = node.key === selectedKey ? 90 : 0
  const seededDepth = (seed - 0.5) * 120
  return clamp(communityDepth + scoreLift + rankLift + selectedLift + seededDepth, -MAX_DEPTH, MAX_DEPTH)
}

function deriveNodeRadius(node: PeopleRelationshipGraphNode, state: RelationshipGalaxy3DNodeState): number {
  const base = Math.max(node.size, node.kind === 'owner' ? 13 : 4.8)
  if (state === 'selected') return base + 5
  if (state === 'neighbor') return base + 1.8
  return base
}

function deriveLabelTier(
  node: PeopleRelationshipGraphNode,
  state: RelationshipGalaxy3DNodeState,
  totalNodes: number
): 0 | 1 | 2 {
  if (state === 'selected') return 2
  if (node.labelVisibility === 2) return 2
  if (node.kind === 'owner') return 2
  if (state === 'neighbor' && node.rank <= 60) return 1
  if (node.labelVisibility === 1 && totalNodes <= 600) return 1
  if (node.rank <= 12) return 1
  return 0
}

function deriveNodeOpacity(state: RelationshipGalaxy3DNodeState): number {
  if (state === 'selected') return 1
  if (state === 'neighbor') return 0.92
  if (state === 'dimmed') return 0.16
  return 0.82
}

function deriveNodeGlow(node: PeopleRelationshipGraphNode, state: RelationshipGalaxy3DNodeState): number {
  if (state === 'selected') return 1
  if (node.kind === 'owner') return 0.88
  if (state === 'neighbor') return 0.66
  if (state === 'dimmed') return 0.12
  if (node.rank <= 10) return 0.72
  if (node.labelVisibility === 2) return 0.56
  return 0.34
}

function deriveBounds(nodes: RelationshipGalaxy3DNode[]): RelationshipGalaxy3DScene['bounds'] {
  if (nodes.length === 0) {
    return {
      minX: -500,
      maxX: 500,
      minY: -500,
      maxY: 500,
      minZ: -MAX_DEPTH,
      maxZ: MAX_DEPTH,
      width: 1000,
      height: 1000,
      depth: MAX_DEPTH * 2,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
    minZ = Math.min(minZ, node.z)
    maxZ = Math.max(maxZ, node.z)
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    width: Math.max(800, maxX - minX),
    height: Math.max(800, maxY - minY),
    depth: Math.max(400, maxZ - minZ),
  }
}

function parseNodeColor(node: PeopleRelationshipGraphNode): number {
  const fallback = node.pool === 'friend' || node.kind === 'owner' ? DEFAULT_FRIEND_COLOR : DEFAULT_GROUPMATE_COLOR
  if (!node.color) return fallback

  const normalized = node.color.startsWith('#') ? node.color.slice(1) : node.color
  const parsed = Number.parseInt(normalized, 16)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hashToSignedUnit(value: string): number {
  return hashToUnit(value) * 2 - 1
}

function hashToUnit(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
