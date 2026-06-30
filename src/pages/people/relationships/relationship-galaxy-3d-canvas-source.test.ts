/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-3d-canvas-source.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

function readCanvasSource(): string {
  return readFileSync(new URL('./components/RelationshipGalaxyThreeCanvas.vue', import.meta.url), 'utf8')
}

describe('RelationshipGalaxyThreeCanvas scene wiring', () => {
  it('passes the selected node into 3D scene construction', () => {
    const source = readCanvasSource()
    const initialSceneModel = source.slice(
      source.indexOf('const sceneModel'),
      source.indexOf('const selectedVisibleLabelKeys')
    )
    const renderGraph = source.slice(
      source.indexOf('function renderGraph'),
      source.indexOf('function updateSelectedVisibleLabelKeys')
    )

    assert.ok(
      initialSceneModel.includes('buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey })'),
      'initial 3D scene must respect selectedKey when the canvas is mounted with an active selection'
    )
    assert.ok(
      renderGraph.includes('buildRelationshipGalaxy3DScene(props.graph, { selectedKey: props.selectedKey })'),
      '3D canvas must rebuild scene topology with selectedKey so focused neighborhoods are centered and filtered'
    )
  })

  it('rebuilds the 3D scene when selectedKey changes', () => {
    const source = readCanvasSource()
    const selectedKeyWatcher = source.slice(
      source.indexOf('watch(\n  () => props.selectedKey'),
      source.indexOf('watch(\n  () => props.privacyMode')
    )

    assert.ok(
      selectedKeyWatcher.includes('renderGraph(false)'),
      'selectedKey changes affect 3D topology and must not be handled as a label-only update'
    )
  })

  it('uses camera view offset for right panel safe area instead of moving the orbit target', () => {
    const source = readCanvasSource()
    const resizeCanvas = source.slice(
      source.indexOf('function resizeCanvas'),
      source.indexOf('function handlePointerMove')
    )
    const applySafeArea = source.slice(
      source.indexOf('function applySafeAreaToCameraPose'),
      source.indexOf('function vectorToPose')
    )

    assert.ok(source.includes('camera.setViewOffset('), '3D safe area should use projection view offset')
    assert.ok(source.includes('camera.clearViewOffset()'), '3D safe area should clear projection offset when closed')
    assert.ok(
      resizeCanvas.includes('applyCameraSafeAreaProjection(size)'),
      'resizing the canvas must preserve the current safe-area projection'
    )
    assert.ok(
      applySafeArea.includes('applyCameraSafeAreaProjection(size)'),
      'focus and fit camera poses must apply the safe-area projection separately from the orbit target'
    )
  })
})
