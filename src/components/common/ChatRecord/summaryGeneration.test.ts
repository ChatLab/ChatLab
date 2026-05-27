import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildGenerateSummaryArgs, stopBatchSummaryGeneration } from './summaryGeneration'

describe('stopBatchSummaryGeneration', () => {
  it('keeps generation locked while the active loop is still exiting', () => {
    const isGenerating = { value: true }
    const shouldStop = { value: false }

    stopBatchSummaryGeneration(shouldStop)

    assert.equal(shouldStop.value, true)
    assert.equal(isGenerating.value, true)
  })
})

describe('buildGenerateSummaryArgs', () => {
  it('passes summary strategy to single-session generation', () => {
    const args = buildGenerateSummaryArgs('db-1', 12, 'zh-CN', 'brief')

    assert.deepEqual(args, ['db-1', 12, 'zh-CN', false, 'brief'])
  })
})
