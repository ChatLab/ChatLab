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
})
