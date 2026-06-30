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
})
