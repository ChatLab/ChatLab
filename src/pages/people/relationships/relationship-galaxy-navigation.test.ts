import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureRelationshipGalaxyPanoramaView,
  DEFAULT_RELATIONSHIP_GALAXY_VIEW_MODE,
  resolveRelationshipGalaxyFallbackViewMode,
  restoreRelationshipGalaxyPanoramaView,
} from './relationship-galaxy-navigation'

test('captures the panorama before selection and restores it when returning', () => {
  const savedView = { kind: '3d', position: { x: 1, y: 2, z: 3 } }
  const calls: string[] = []
  const canvas = {
    captureView: () => {
      calls.push('capture')
      return savedView
    },
    restoreView: (view: unknown) => {
      calls.push(`restore:${view === savedView}`)
      return true
    },
    fitView: () => calls.push('fit'),
  }

  const captured = captureRelationshipGalaxyPanoramaView(canvas, null, null)
  assert.equal(captured, savedView)
  assert.equal(restoreRelationshipGalaxyPanoramaView(canvas, captured), true)
  assert.deepEqual(calls, ['capture', 'restore:true'])

  canvas.restoreView = () => false
  assert.equal(restoreRelationshipGalaxyPanoramaView(canvas, savedView), false)
  assert.equal(calls.at(-1), 'fit')
})

test('defaults to 3D and falls back to 2D only after a 3D failure', () => {
  assert.equal(DEFAULT_RELATIONSHIP_GALAXY_VIEW_MODE, '3d')
  assert.equal(resolveRelationshipGalaxyFallbackViewMode('3d'), '2d')
  assert.equal(resolveRelationshipGalaxyFallbackViewMode('2d'), '2d')
})
