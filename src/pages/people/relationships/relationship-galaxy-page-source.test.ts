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
  it('restores the saved panorama view when returning from a selected node', () => {
    const source = readPageSource()
    const backToPanorama = source.slice(
      source.indexOf('function backToPanorama()'),
      source.indexOf('function closeDetailPanel()')
    )
    const closeDetailPanel = source.slice(
      source.indexOf('function closeDetailPanel()'),
      source.indexOf('function clearSearch()')
    )
    const selectNode = source.slice(
      source.indexOf('async function selectNode'),
      source.indexOf('function handleThreeCanvasFallback')
    )

    assert.ok(backToPanorama.includes('selectedKey.value = null'))
    assert.ok(backToPanorama.includes('canvasSelectedKey.value = null'))
    assert.ok(backToPanorama.includes('isDetailPanelOpen.value = false'))
    assert.ok(
      selectNode.includes('rememberPanoramaViewBeforeSelection()'),
      'selecting a node should capture the current panorama camera before focusing the node'
    )
    assert.ok(
      backToPanorama.includes('restorePanoramaView()'),
      'returning to panorama should restore the previous browsing view instead of forcing a new fit'
    )
    assert.ok(
      closeDetailPanel.includes('backToPanorama()'),
      'closing the detail panel should exit node focus and restore the panorama view'
    )
    assert.equal(
      backToPanorama.includes('canvasRef.value?.fitView()'),
      false,
      'returning to panorama should not always refit and lose the previous camera angle'
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

  it('uses masked relationship names instead of rank-only privacy labels', () => {
    const source = readPageSource()
    const displayName = source.slice(
      source.indexOf('function displayName'),
      source.indexOf('function platformIdentity')
    )
    const avatarText = source.slice(source.indexOf('function avatarText'), source.indexOf('function avatarSrc'))
    const avatarSrc = source.slice(source.indexOf('function avatarSrc'), source.indexOf('function displayName'))
    const platformIdentity = source.slice(
      source.indexOf('function platformIdentity'),
      source.indexOf('function poolLabel')
    )

    assert.ok(displayName.includes('maskRelationshipGalaxyPrivateText(name)'))
    assert.ok(avatarText.includes('relationshipGalaxyPrivateAvatarText()'))
    assert.ok(avatarSrc.includes('privacyMode.value ? null : node.avatar'))
    assert.ok(platformIdentity.includes('maskRelationshipGalaxyPrivateText(identity)'))
    assert.equal(displayName.includes('`#${node.rank}`'), false)
  })
})
