/**
 * Run: pnpm test -- src/pages/people/relationships/relationship-galaxy-page-source.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

function readPageSource(): string {
  return readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
}

describe('people relationships page source', () => {
  it('clears canvas selection when returning to the panorama', () => {
    const source = readPageSource()
    const backToPanorama = source.slice(
      source.indexOf('function backToPanorama()'),
      source.indexOf('function closeDetailPanel()')
    )

    assert.ok(backToPanorama.includes('selectedKey.value = null'))
    assert.ok(backToPanorama.includes('canvasSelectedKey.value = null'))
    assert.ok(backToPanorama.includes('isDetailPanelOpen.value = false'))
    assert.ok(
      backToPanorama.includes('canvasRef.value?.fitView()'),
      'returning to panorama should fit the full graph instead of refocusing the selected node'
    )
    assert.equal(
      backToPanorama.includes('canvasRef.value?.focusNode(selectedKey.value)'),
      false,
      'returning to panorama must not keep the selected node focused'
    )
  })

  it('defaults to 3D while hiding the manual 3D and 2D switcher', () => {
    const source = readPageSource()
    const template = source.slice(source.indexOf('<template>'))
    const fallback = source.slice(
      source.indexOf('function handleThreeCanvasFallback()'),
      source.indexOf('function backToPanorama()')
    )

    assert.ok(source.includes("const viewMode = ref<GalaxyViewMode>('3d')"))
    assert.equal(source.includes('const viewModeTabs = computed'), false)
    assert.equal(template.includes('v-model="viewMode"'), false)
    assert.ok(fallback.includes("viewMode.value = '2d'"), '2D should remain as automatic fallback for 3D failures')
  })
})
