import type { RelationshipGalaxy3DEdge, RelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'

export interface RelationshipGalaxy3DAmbientParticle {
  x: number
  y: number
  z: number
  size: number
  opacity: number
  color: number
  phase: number
}

export interface RelationshipGalaxy3DFogVeil {
  x: number
  y: number
  z: number
  width: number
  height: number
  opacity: number
  color: number
  rotation: number
  foreground: boolean
}

const AMBIENT_COLORS = [0xf5f8ff, 0x9bbcff, 0xff6fa8, 0xffb36b, 0xb59cff, 0x74ddcf]

export function buildRelationshipGalaxy3DAmbientParticles(
  model: RelationshipGalaxy3DScene
): RelationshipGalaxy3DAmbientParticle[] {
  const count = clamp(Math.round(900 + model.nodes.length * 3.2), 900, 2200)
  const random = createDeterministicRandom(
    model.nodes
      .map((node) => node.key)
      .sort()
      .join('|')
  )
  const xRadius = Math.max(900, model.bounds.width * 0.62)
  const yRadius = Math.max(560, model.bounds.height * 0.72)
  const zRadius = Math.max(420, model.bounds.depth * 0.72)

  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2
    const distance = Math.pow(random(), 0.62)
    const heightNoise = (random() - 0.5) * 2
    const color = AMBIENT_COLORS[Math.floor(random() * AMBIENT_COLORS.length)] ?? AMBIENT_COLORS[0]

    return {
      x: roundNum(Math.cos(angle) * xRadius * distance + (random() - 0.5) * xRadius * 0.12),
      y: roundNum(Math.sin(angle) * yRadius * distance + heightNoise * yRadius * 0.14),
      z: roundNum((random() - 0.5) * zRadius * 2),
      size: roundNum(3.4 + Math.pow(random(), 2.2) * 8.6),
      opacity: roundNum(0.16 + Math.pow(random(), 1.5) * 0.42, 3),
      color,
      phase: roundNum(random() * Math.PI * 2, 4),
    }
  })
}

export function buildRelationshipGalaxy3DFogVeils(model: RelationshipGalaxy3DScene): RelationshipGalaxy3DFogVeil[] {
  const random = createDeterministicRandom(
    `fog:${model.nodes
      .map((node) => node.key)
      .sort()
      .join('|')}`
  )

  return model.communities.flatMap((community, communityIndex) =>
    Array.from({ length: 3 }, (_, layerIndex) => {
      const angle = random() * Math.PI * 2
      const offset = community.radius * (0.16 + random() * 0.48)
      const foreground = (communityIndex + layerIndex) % 3 === 0
      return {
        x: roundNum(community.x + Math.cos(angle) * offset),
        y: roundNum(community.y + Math.sin(angle) * offset * 0.72),
        z: roundNum(community.z + (random() - 0.5) * community.radius * 1.6),
        width: roundNum(community.radius * (2.2 + random() * 1.5)),
        height: roundNum(community.radius * (1.05 + random() * 0.75)),
        opacity: roundNum(
          clamp(community.opacity * (foreground ? 0.26 + random() * 0.12 : 0.38 + random() * 0.18), 0.026, 0.082),
          3
        ),
        color: community.color,
        rotation: roundNum((random() - 0.5) * 0.85, 3),
        foreground,
      }
    })
  )
}

export function selectRelationshipGalaxy3DAmbientEdgeIds(model: RelationshipGalaxy3DScene): Set<string> {
  const limit = clamp(Math.round(model.nodes.length * 1.7), 32, 200)
  return new Set(
    [...model.edges]
      .sort(compareAmbientEdges)
      .slice(0, limit)
      .map((edge) => edge.edge.id)
  )
}

export function selectRelationshipGalaxy3DSelectedEdgeIds(model: RelationshipGalaxy3DScene): Set<string> {
  return new Set(model.edges.filter((edge) => edge.highlighted).map((edge) => edge.edge.id))
}

export function selectRelationshipGalaxy3DPrimarySelectedEdgeIds(
  model: RelationshipGalaxy3DScene,
  limit = 24
): Set<string> {
  return new Set(
    model.edges
      .filter((edge) => edge.highlighted)
      .sort(compareAmbientEdges)
      .slice(0, limit)
      .map((edge) => edge.edge.id)
  )
}

function compareAmbientEdges(a: RelationshipGalaxy3DEdge, b: RelationshipGalaxy3DEdge): number {
  return (
    Number(b.edge.visibility) - Number(a.edge.visibility) ||
    b.edge.weight - a.edge.weight ||
    a.edge.id.localeCompare(b.edge.id)
  )
}

function createDeterministicRandom(seedText: string): () => number {
  let state = hashToUint(seedText || 'relationship-galaxy') || 0x6d2b79f5
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}

function hashToUint(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
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
