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

const OWNER_COLOR = 0xfff2a8
const FRIEND_NODE_COLORS = [0xfff6da, 0xffdf9a, 0xdcecff, 0xffffff, 0xffb47a]
const GROUPMATE_NODE_COLORS = [0xdbe9ff, 0xf8fbff, 0xffedc7, 0xcfe6ff, 0xffc49a]
const MAX_DEPTH = 800
const MAX_3D_HORIZONTAL_SPAN = 3600

export function buildRelationshipGalaxy3DScene(
  graph: PeopleRelationshipsGraphData,
  options: RelationshipGalaxy3DSceneOptions = {}
): RelationshipGalaxy3DScene {
  const selectedKey = options.selectedKey ?? null
  const selectedNeighborKeys = buildSelectedNeighborKeys(graph.edges, selectedKey)
  const layout = deriveCompactLayout(graph.nodes, selectedKey)

  const nodes = graph.nodes.map((node) => {
    const state = resolveNodeState(node.key, selectedKey, selectedNeighborKeys)
    const seed = hashToUnit(node.key)
    const z = deriveNodeDepth(node, selectedKey, seed)
    const radius = deriveNodeRadius(node, state)
    const labelTier = deriveLabelTier(node, state, graph.nodes.length)

    return {
      key: node.key,
      node,
      x: roundNum((node.x - layout.centerX) * layout.scale, 2),
      y: roundNum((node.y - layout.centerY) * layout.scale, 2),
      z,
      radius,
      color: parseNodeColor(node),
      state,
      labelTier,
      opacity: deriveNodeOpacity(state),
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
      ? 0.018
      : highlighted
        ? 0.32 + Math.min(0.2, edge.weight * 0.2)
        : edge.visibility === 2
          ? 0.09
          : 0.06

    return [
      {
        edge,
        source,
        target,
        color: source.color,
        alpha,
        width: deriveEdgeWidth(edge, highlighted, dimmedBySelection),
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

function deriveCompactLayout(
  nodes: PeopleRelationshipGraphNode[],
  selectedKey: string | null
): {
  centerX: number
  centerY: number
  scale: number
} {
  if (nodes.length === 0) return { centerX: 0, centerY: 0, scale: 1 }

  const selected = selectedKey ? nodes.find((node) => node.key === selectedKey) : null
  const owner = nodes.find((node) => node.kind === 'owner')
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
  }

  const width = maxX - minX
  const height = maxY - minY
  const span = Math.max(width, height)
  return {
    centerX: selected?.x ?? owner?.x ?? (minX + maxX) / 2,
    centerY: selected?.y ?? owner?.y ?? (minY + maxY) / 2,
    scale: span > MAX_3D_HORIZONTAL_SPAN ? MAX_3D_HORIZONTAL_SPAN / span : 1,
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

function deriveEdgeWidth(edge: PeopleRelationshipGraphEdge, highlighted: boolean, dimmedBySelection: boolean): number {
  const base = 0.75 + Math.log10(edge.weight + 1) * 0.7 + (edge.visibility === 2 ? 0.18 : 0)
  if (highlighted) return Math.min(2.2, Math.max(1.65, base + 0.65))
  if (dimmedBySelection) return Math.min(0.8, Math.max(0.55, base * 0.58))
  return Math.min(1.35, Math.max(0.85, base))
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
  const communityDepth = hashToSignedUnit(node.communityId || 'default') * 280
  const scoreLift = (Math.max(0, Math.min(1, node.score)) - 0.5) * 220
  const rankLift = Math.max(0, 1 - (node.rank - 1) / 80) * 180
  const selectedLift = node.key === selectedKey ? 150 : 0
  const seededDepth = (seed - 0.5) * 350
  return clamp(communityDepth + scoreLift + rankLift + selectedLift + seededDepth, -MAX_DEPTH, MAX_DEPTH)
}

function deriveNodeRadius(node: PeopleRelationshipGraphNode, state: RelationshipGalaxy3DNodeState): number {
  let base = Math.max(node.size * 0.5, node.kind === 'owner' ? 14 : 1.6)
  const importance = Math.max(0, 1 - (node.rank - 1) / 50)
  base += Math.pow(importance, 1.35) * 6
  if (node.rank <= 3) base += 2.5
  else if (node.rank <= 10) base += 1.2

  if (state === 'selected') return base + 5.5
  if (state === 'neighbor') return base + 1.5
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
  if (state === 'neighbor' && node.rank <= 30) return 1
  if (node.labelVisibility === 1 && totalNodes <= 300) return 1
  if (node.rank <= 6) return 1
  return 0
}

function deriveNodeOpacity(state: RelationshipGalaxy3DNodeState): number {
  if (state === 'selected') return 1
  if (state === 'neighbor') return 0.95
  if (state === 'dimmed') return 0.08
  return 0.75
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
  if (node.kind === 'owner') return OWNER_COLOR
  return pickPaletteColor(node)
}

function pickPaletteColor(node: PeopleRelationshipGraphNode): number {
  const palette = node.pool === 'friend' ? FRIEND_NODE_COLORS : GROUPMATE_NODE_COLORS
  const index = hashToUint(`${node.communityId}:${node.key}:${node.rank}:${node.pool}`) % palette.length
  return palette[index] ?? palette[0]
}

function hashToSignedUnit(value: string): number {
  return hashToUnit(value) * 2 - 1
}

function hashToUnit(value: string): number {
  return hashToUint(value) / 0xffffffff
}

function hashToUint(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function roundNum(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
