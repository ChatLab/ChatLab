import type {
  RelationshipGalaxyRenderEdge,
  RelationshipGalaxyRenderGraph,
  RelationshipGalaxyRenderNode,
} from '@openchatlab/shared-types'
import { buildRelationshipVisibleLabelKeys } from './relationship-galaxy-connections'

export type RelationshipGalaxy3DNodeState = 'normal' | 'selected' | 'neighbor' | 'dimmed'

export interface RelationshipGalaxy3DNode {
  key: string
  node: RelationshipGalaxyRenderNode
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
  edge: RelationshipGalaxyRenderEdge
  source: RelationshipGalaxy3DNode
  target: RelationshipGalaxy3DNode
  color: number
  alpha: number
  width: number
  highlighted: boolean
}

export interface RelationshipGalaxy3DCommunity {
  id: string
  x: number
  y: number
  z: number
  radius: number
  color: number
  opacity: number
  nodeCount: number
}

export interface RelationshipGalaxy3DScene {
  nodes: RelationshipGalaxy3DNode[]
  edges: RelationshipGalaxy3DEdge[]
  communities: RelationshipGalaxy3DCommunity[]
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
const FALLBACK_COMMUNITY_COLORS = [0xff86ad, 0x72b8ff, 0x9f8cff, 0x67d9d0, 0xf2c879, 0x8fdaa8]
const MAX_3D_SCENE_RADIUS = 1700
const PANORAMA_LABEL_LIMIT = 8
const SELECTED_LABEL_LIMIT = 12
const PANORAMA_AXIS_SCALE = {
  x: 1.42,
  y: 0.84,
  z: 1,
}
interface RelationshipGalaxy3DVector {
  x: number
  y: number
  z: number
}

export function buildRelationshipGalaxy3DScene(
  graph: RelationshipGalaxyRenderGraph,
  options: RelationshipGalaxy3DSceneOptions = {}
): RelationshipGalaxy3DScene {
  const selectedKey = options.selectedKey ?? null
  const renderGraph = graph
  const selectedNeighborKeys = buildSelectedNeighborKeys(renderGraph.edges, selectedKey)
  const visibleLabelKeys = selectedKey
    ? buildRelationshipVisibleLabelKeys(renderGraph, selectedKey, { limit: SELECTED_LABEL_LIMIT })
    : buildPanoramaVisibleLabelKeys(renderGraph.nodes)
  const communityColorById = buildCommunityColorMap(renderGraph)

  const nodes = renderGraph.nodes.map((node) => {
    const state = resolveNodeState(node.key, selectedKey, selectedNeighborKeys)
    const seed = hashToUnit(node.key)
    const position = deriveSphericalNodePosition(node, seed)
    const radius = deriveNodeRadius(node, state)
    const labelTier = deriveLabelTier(node, state, renderGraph.nodes.length, visibleLabelKeys)

    return {
      key: node.key,
      node,
      x: position.x,
      y: position.y,
      z: position.z,
      radius,
      color: parseNodeColor(node, communityColorById),
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
    communities: buildSceneCommunities(nodes, renderGraph),
    selectedNeighborKeys,
    bounds: deriveBounds(nodes),
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

function buildSelectedNeighborKeys(edges: RelationshipGalaxyRenderEdge[], selectedKey: string | null): Set<string> {
  const keys = new Set<string>()
  if (!selectedKey) return keys

  for (const edge of edges) {
    if (edge.sourceKey === selectedKey) keys.add(edge.targetKey)
    if (edge.targetKey === selectedKey) keys.add(edge.sourceKey)
  }

  return keys
}

function deriveEdgeWidth(edge: RelationshipGalaxyRenderEdge, highlighted: boolean, dimmedBySelection: boolean): number {
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

function deriveSphericalNodePosition(node: RelationshipGalaxyRenderNode, seed: number): RelationshipGalaxy3DVector {
  if (node.visualRole === 'anchor') return { x: 0, y: 0, z: 0 }

  const direction = deriveNodeDirection(node)
  const orbitRadius = deriveNodeOrbitRadius(node, seed)

  return {
    x: roundNum(direction.x * orbitRadius * PANORAMA_AXIS_SCALE.x, 2),
    y: roundNum(direction.y * orbitRadius * PANORAMA_AXIS_SCALE.y, 2),
    z: roundNum(direction.z * orbitRadius * PANORAMA_AXIS_SCALE.z, 2),
  }
}

function deriveNodeDirection(node: RelationshipGalaxyRenderNode): RelationshipGalaxy3DVector {
  const communityDirection = deriveUnitVector(`community:panorama:${node.communityId || 'default'}`)
  const nodeDirection = deriveUnitVector(`node:panorama:${node.key}`)

  return normalizeVector({
    x: communityDirection.x * 1.15 + nodeDirection.x * 0.95,
    y: communityDirection.y * 1.15 + nodeDirection.y * 0.95,
    z: communityDirection.z * 1.15 + nodeDirection.z * 0.95,
  })
}

function deriveNodeOrbitRadius(node: RelationshipGalaxyRenderNode, seed: number): number {
  const importance = deriveNodeImportance(node)
  const jitter = (seed - 0.5) * 120

  const visualRole = node.visualRole ?? 'standard'
  const minRadius = visualRole === 'close' ? 280 : 620
  const maxRadius = visualRole === 'close' ? 1180 : MAX_3D_SCENE_RADIUS
  const rankNoisePush = visualRole === 'standard' ? Math.max(0, (node.rank - 80) / 220) * 160 : 0
  return clamp(maxRadius - importance * (maxRadius - minRadius) + rankNoisePush + jitter, 180, MAX_3D_SCENE_RADIUS)
}

function deriveNodeImportance(node: RelationshipGalaxyRenderNode): number {
  if (node.visualRole === 'anchor') return 1
  if (typeof node.importance === 'number') return clamp(node.importance, 0, 1)
  const scoreImportance = clamp(node.score, 0, 1)
  const rankImportance = clamp(1 - (node.rank - 1) / 120, 0, 1)
  return clamp(scoreImportance * 0.58 + rankImportance * 0.42, 0, 1)
}

function deriveNodeRadius(node: RelationshipGalaxyRenderNode, state: RelationshipGalaxy3DNodeState): number {
  let base = Math.max(node.size * 0.42, node.visualRole === 'anchor' ? 11 : 1.6)
  const importance = Math.max(0, 1 - (node.rank - 1) / 50)
  base += Math.pow(importance, 1.35) * 6
  if (node.rank <= 3) base += 2.5
  else if (node.rank <= 10) base += 1.2

  const normalized = clamp(base, 2.2, 18)
  if (state === 'selected') return Math.min(22, normalized + 4)
  if (state === 'neighbor') return Math.min(20, normalized + 1.5)
  return normalized
}

function deriveLabelTier(
  node: RelationshipGalaxyRenderNode,
  state: RelationshipGalaxy3DNodeState,
  totalNodes: number,
  visibleLabelKeys: Set<string> | null
): 0 | 1 | 2 {
  if (visibleLabelKeys) {
    if (!visibleLabelKeys.has(node.key)) return 0
    return state === 'selected' || node.visualRole === 'anchor' || (state === 'normal' && node.labelVisibility === 2)
      ? 2
      : 1
  }

  if (state === 'selected') return 2
  if (node.labelVisibility === 2) return 2
  if (node.visualRole === 'anchor') return 2
  if (state === 'neighbor' && node.rank <= 30) return 1
  if (node.labelVisibility === 1 && totalNodes <= 300) return 1
  if (node.rank <= 6) return 1
  return 0
}

function buildPanoramaVisibleLabelKeys(nodes: RelationshipGalaxyRenderNode[]): Set<string> {
  return new Set(
    [...nodes]
      .sort((a, b) => {
        const anchorDiff = Number(b.visualRole === 'anchor') - Number(a.visualRole === 'anchor')
        const labelDiff = b.labelVisibility - a.labelVisibility
        const importanceDiff = deriveNodeImportance(b) - deriveNodeImportance(a)
        return anchorDiff || labelDiff || importanceDiff || a.rank - b.rank || a.key.localeCompare(b.key)
      })
      .slice(0, PANORAMA_LABEL_LIMIT)
      .map((node) => node.key)
  )
}

function deriveNodeOpacity(state: RelationshipGalaxy3DNodeState): number {
  if (state === 'selected') return 1
  if (state === 'neighbor') return 0.95
  if (state === 'dimmed') return 0.1
  return 0.82
}

function deriveBounds(nodes: RelationshipGalaxy3DNode[]): RelationshipGalaxy3DScene['bounds'] {
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

function parseNodeColor(node: RelationshipGalaxyRenderNode, communityColorById: ReadonlyMap<string, number>): number {
  if (node.visualRole === 'anchor') return OWNER_COLOR
  return (
    communityColorById.get(node.communityId) ??
    parseHexColor(node.color) ??
    pickFallbackCommunityColor(node.communityId)
  )
}

function buildCommunityColorMap(graph: RelationshipGalaxyRenderGraph): Map<string, number> {
  const colors = new Map<string, number>()
  for (const community of graph.communities) {
    colors.set(community.id, parseHexColor(community.color) ?? pickFallbackCommunityColor(community.id))
  }
  for (const node of graph.nodes) {
    if (colors.has(node.communityId)) continue
    colors.set(node.communityId, parseHexColor(node.color) ?? pickFallbackCommunityColor(node.communityId))
  }
  return colors
}

function buildSceneCommunities(
  nodes: RelationshipGalaxy3DNode[],
  graph: RelationshipGalaxyRenderGraph
): RelationshipGalaxy3DCommunity[] {
  const sourceCommunityById = new Map(graph.communities.map((community) => [community.id, community]))
  const nodesByCommunity = new Map<string, RelationshipGalaxy3DNode[]>()

  for (const node of nodes) {
    const group = nodesByCommunity.get(node.node.communityId) ?? []
    group.push(node)
    nodesByCommunity.set(node.node.communityId, group)
  }

  return [...nodesByCommunity.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([id, communityNodes]) => {
      const x = average(communityNodes.map((node) => node.x))
      const y = average(communityNodes.map((node) => node.y))
      const z = average(communityNodes.map((node) => node.z))
      const spread = Math.max(
        120,
        ...communityNodes.map((node) => Math.hypot(node.x - x, node.y - y, (node.z - z) * 0.45))
      )
      const sourceCommunity = sourceCommunityById.get(id)
      const color = parseHexColor(sourceCommunity?.color) ?? communityNodes[0]?.color ?? pickFallbackCommunityColor(id)

      return {
        id,
        x: roundNum(x),
        y: roundNum(y),
        z: roundNum(z),
        radius: roundNum(clamp(spread * 1.08 + Math.sqrt(communityNodes.length) * 24, 260, 720)),
        color,
        opacity: roundNum(clamp(0.085 + Math.log10(communityNodes.length + 1) * 0.026, 0.095, 0.17), 3),
        nodeCount: communityNodes.length,
      }
    })
}

function parseHexColor(value: string | null | undefined): number | null {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return null
  return Number.parseInt(value.slice(1), 16)
}

function pickFallbackCommunityColor(communityId: string): number {
  const index = hashToUint(communityId || 'default') % FALLBACK_COMMUNITY_COLORS.length
  return FALLBACK_COMMUNITY_COLORS[index] ?? FALLBACK_COMMUNITY_COLORS[0]
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
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
