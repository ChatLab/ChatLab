import type { RelationshipGalaxy3DScene } from './relationship-galaxy-3d-scene'

export interface RelationshipGalaxy3DVector {
  x: number
  y: number
  z: number
}

export interface RelationshipGalaxy3DCameraPose {
  position: RelationshipGalaxy3DVector
  target: RelationshipGalaxy3DVector
}

export function buildRelationshipGalaxy3DFitCameraPose(
  bounds: RelationshipGalaxy3DScene['bounds']
): RelationshipGalaxy3DCameraPose {
  const span = Math.max(bounds.width, bounds.height, bounds.depth, 900)

  return {
    position: {
      x: 0,
      y: -span * 0.3,
      z: span * 0.62,
    },
    target: { x: 0, y: 0, z: 0 },
  }
}
