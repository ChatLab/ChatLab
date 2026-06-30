import * as THREE from 'three'

export type RelationshipGalaxy3DEdgeRenderBucket = 'dim' | 'normal' | 'highlight'

const EDGE_TINT = new THREE.Color(0xffffff)

export function setRelationshipGalaxy3DEdgeGradientColor(
  output: THREE.Color,
  source: THREE.Color,
  target: THREE.Color,
  bucket: RelationshipGalaxy3DEdgeRenderBucket,
  progress: number
): THREE.Color {
  output.copy(source).lerp(target, clampUnit(progress))
  output.lerp(EDGE_TINT, getEdgeTintMix(bucket))
  output.multiplyScalar(getEdgeBrightness(bucket))
  return output
}

function clampUnit(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function getEdgeTintMix(bucket: RelationshipGalaxy3DEdgeRenderBucket): number {
  if (bucket === 'highlight') return 0.06
  if (bucket === 'normal') return 0.16
  return 0.26
}

function getEdgeBrightness(bucket: RelationshipGalaxy3DEdgeRenderBucket): number {
  if (bucket === 'highlight') return 0.95
  if (bucket === 'normal') return 0.5
  return 0.34
}
