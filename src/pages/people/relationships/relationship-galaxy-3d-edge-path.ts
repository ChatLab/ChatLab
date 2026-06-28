import * as THREE from 'three'

const EDGE_CURVE_SEGMENTS = 6

export function buildRelationshipGalaxy3DEdgeCurvePoints(
  source: THREE.Vector3,
  target: THREE.Vector3,
  seed: number
): THREE.Vector3[] {
  const distance = source.distanceTo(target)
  if (distance <= 0.001) return [source.clone(), target.clone()]

  const direction = target.clone().sub(source).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  if (Math.abs(direction.y) > 0.9) up.set(1, 0, 0)

  const perp1 = new THREE.Vector3().crossVectors(direction, up).normalize()
  const perp2 = new THREE.Vector3().crossVectors(direction, perp1).normalize()
  const controlOffset = buildCurveOffset(perp1, perp2, seed).multiplyScalar(Math.max(5, distance * 0.08))

  const control = source.clone().lerp(target, 0.5).add(controlOffset)
  return new THREE.QuadraticBezierCurve3(source, control, target).getPoints(EDGE_CURVE_SEGMENTS)
}

function buildCurveOffset(perp1: THREE.Vector3, perp2: THREE.Vector3, seed: number): THREE.Vector3 {
  const bend1 = ((seed * 7.1) % 1) - 0.5
  const bend2 = ((seed * 13.3) % 1) - 0.5
  const offset = perp1.clone().multiplyScalar(bend1).add(perp2.clone().multiplyScalar(bend2))
  if (offset.lengthSq() <= 0.0001) return perp1.clone()
  return offset.normalize()
}
