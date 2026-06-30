import type {
  PeopleRelationshipGraphEdge,
  PeopleRelationshipGraphNode,
  PeopleRelationshipsGraphData,
} from '@openchatlab/shared-types'
import {
  buildRelationshipVisibleGraphForSelection,
  buildRelationshipVisibleLabelKeys,
} from './relationship-galaxy-connections'

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

const OWNER_COLOR = 0xf8fbff
const FRIEND_NODE_COLORS = [
  0xff8fb3, 0xffc857, 0x7dd3fc, 0xa78bfa, 0x86efac, 0xfb7185, 0x38bdf8, 0xf0abfc, 0xfde68a, 0x5eead4,
]
const GROUPMATE_NODE_COLORS = [
  0xffb86b, 0x60a5fa, 0x34d399, 0xe879f9, 0xfacc15, 0x5eead4, 0xc084fc, 0xf472b6, 0xa3e635, 0x93c5fd,
]
const MAX_3D_SCENE_RADIUS = 1700
const PANORAMA_AXIS_SCALE = {
  x: 1.42,
  y: 0.84,
  z: 1,
}
const SPHERICAL_AXIS_SCALE = {
  x: 1,
  y: 1,
  z: 1,
}

interface RelationshipGalaxy3DVector {
  x: number
  y: number
  z: number
}

export function buildRelationshipGalaxy3DScene(
  graph: PeopleRelationshipsGraphData,
  options: RelationshipGalaxy3DSceneOptions = {}
): RelationshipGalaxy3DScene {
  const selectedKey = options.selectedKey ?? null
  const renderGraph = buildRelationshipVisibleGraphForSelection(graph, selectedKey)
  const selectedNeighborKeys = buildSelectedNeighborKeys(renderGraph.edges, selectedKey)
  const visibleLabelKeys = selectedKey ? buildRelationshipVisibleLabelKeys(renderGraph, selectedKey) : null

  const nodes = renderGraph.nodes.map((node) => {
    const state = resolveNodeState(node.key, selectedKey, selectedNeighborKeys)
    const seed = hashToUnit(node.key)
    const position = deriveSphericalNodePosition(node, state, selectedKey, seed)
    const radius = deriveNodeRadius(node, state)
    const labelTier = deriveLabelTier(node, state, renderGraph.nodes.length, visibleLabelKeys)

    return {
      key: node.key,
      node,
      x: position.x,
      y: position.y,
      z: position.z,
      radius,
      color: parseNodeColor(node),
      state,
      labelTier,
      opacity: deriveNodeOpacity(state),
      seed,
    }
  })

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  const edges = renderGraph.edges.flatMap((edge): RelationshipGalaxy3DEdge[] => {
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
    bounds: deriveBounds(nodes, Boolean(selectedKey)),
  }
}

export function shouldRenderRelationshipGalaxy3DLabel(
  sceneNode: RelationshipGalaxy3DNode,
  selectedKey: string | null,
  _selectedNeighbor: boolean
): boolean {
  if (!selectedKey) return sceneNode.labelTier > 0
  return sceneNode.labelTier > 0
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

function deriveSphericalNodePosition(
  node: PeopleRelationshipGraphNode,
  state: RelationshipGalaxy3DNodeState,
  selectedKey: string | null,
  seed: number
): RelationshipGalaxy3DVector {
  if (state === 'selected') return { x: 0, y: 0, z: 0 }
  if (!selectedKey && node.kind === 'owner') return { x: 0, y: 0, z: 0 }

  const direction = deriveNodeDirection(node, selectedKey)
  const orbitRadius = deriveNodeOrbitRadius(node, state, Boolean(selectedKey), seed)
  const axisScale = selectedKey ? SPHERICAL_AXIS_SCALE : PANORAMA_AXIS_SCALE

  return {
    x: roundNum(direction.x * orbitRadius * axisScale.x, 2),
    y: roundNum(direction.y * orbitRadius * axisScale.y, 2),
    z: roundNum(direction.z * orbitRadius * axisScale.z, 2),
  }
}

function deriveNodeDirection(
  node: PeopleRelationshipGraphNode,
  selectedKey: string | null
): RelationshipGalaxy3DVector {
  const focusSeed = selectedKey ?? 'panorama'
  const communityDirection = deriveUnitVector(`community:${focusSeed}:${node.communityId || 'default'}`)
  const nodeDirection = deriveUnitVector(`node:${focusSeed}:${node.key}`)
  const communityWeight = selectedKey ? 0.7 : 1.15
  const nodeWeight = selectedKey ? 1.15 : 0.95

  return normalizeVector({
    x: communityDirection.x * communityWeight + nodeDirection.x * nodeWeight,
    y: communityDirection.y * communityWeight + nodeDirection.y * nodeWeight,
    z: communityDirection.z * communityWeight + nodeDirection.z * nodeWeight,
  })
}

function deriveNodeOrbitRadius(
  node: PeopleRelationshipGraphNode,
  state: RelationshipGalaxy3DNodeState,
  hasSelectedNode: boolean,
  seed: number
): number {
  const importance = deriveNodeImportance(node)
  const jitter = (seed - 0.5) * 120

  if (hasSelectedNode && state === 'neighbor') {
    return clamp(980 - importance * 650 + jitter, 220, 1050)
  }

  if (hasSelectedNode && state === 'dimmed') {
    return clamp(1670 - importance * 260 + jitter, 1280, MAX_3D_SCENE_RADIUS)
  }

  const minRadius = node.pool === 'friend' ? 280 : 620
  const maxRadius = node.pool === 'friend' ? 1180 : MAX_3D_SCENE_RADIUS
  const rankNoisePush = node.pool === 'non_friend' ? Math.max(0, (node.rank - 80) / 220) * 160 : 0
  return clamp(maxRadius - importance * (maxRadius - minRadius) + rankNoisePush + jitter, 180, MAX_3D_SCENE_RADIUS)
}

function deriveNodeImportance(node: PeopleRelationshipGraphNode): number {
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
  totalNodes: number,
  visibleLabelKeys: Set<string> | null
): 0 | 1 | 2 {
  if (visibleLabelKeys) {
    if (!visibleLabelKeys.has(node.key)) return 0
    return state === 'selected' || node.kind === 'owner' ? 2 : 1
  }

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
  if (state === 'dimmed') return 0.1
  return 0.82
}

function deriveBounds(nodes: RelationshipGalaxy3DNode[], spherical: boolean): RelationshipGalaxy3DScene['bounds'] {
  if (nodes.length === 0) {
    return {
      minX: -500,
      maxX: 500,
      minY: -500,
      maxY: 500,
      minZ: -MAX_3D_SCENE_RADIUS,
      maxZ: MAX_3D_SCENE_RADIUS,
      width: 1000,
      height: 1000,
      depth: MAX_3D_SCENE_RADIUS * 2,
    }
  }

  let maxAbsX = 0
  let maxAbsY = 0
  let maxAbsZ = 0

  for (const node of nodes) {
    maxAbsX = Math.max(maxAbsX, Math.abs(node.x))
    maxAbsY = Math.max(maxAbsY, Math.abs(node.y))
    maxAbsZ = Math.max(maxAbsZ, Math.abs(node.z))
  }

  const radius = Math.max(400, maxAbsX, maxAbsY, maxAbsZ)
  if (spherical) {
    return {
      minX: -radius,
      maxX: radius,
      minY: -radius,
      maxY: radius,
      minZ: -radius,
      maxZ: radius,
      width: radius * 2,
      height: radius * 2,
      depth: radius * 2,
    }
  }

  const xRadius = Math.max(400, maxAbsX)
  const yRadius = Math.max(400, maxAbsY)
  const zRadius = Math.max(400, maxAbsZ)

  return {
    minX: -xRadius,
    maxX: xRadius,
    minY: -yRadius,
    maxY: yRadius,
    minZ: -zRadius,
    maxZ: zRadius,
    width: xRadius * 2,
    height: yRadius * 2,
    depth: zRadius * 2,
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

function deriveUnitVector(value: string): RelationshipGalaxy3DVector {
  const azimuth = hashToUnit(`${value}:azimuth`) * Math.PI * 2
  const z = hashToUnit(`${value}:z`) * 2 - 1
  const planarRadius = Math.sqrt(Math.max(0, 1 - z * z))

  return {
    x: Math.cos(azimuth) * planarRadius,
    y: Math.sin(azimuth) * planarRadius,
    z,
  }
}

function normalizeVector(vector: RelationshipGalaxy3DVector): RelationshipGalaxy3DVector {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length <= 0.0001) return { x: 1, y: 0, z: 0 }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
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
