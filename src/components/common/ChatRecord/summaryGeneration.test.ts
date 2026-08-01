import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildGenerateSummaryArgs } from './summaryGeneration'

describe('buildGenerateSummaryArgs', () => {
  it('passes summary strategy to single-session generation', () => {
    const args = buildGenerateSummaryArgs('db-1', 12, 'zh-CN', 'brief')

    assert.deepEqual(args, ['db-1', 12, 'zh-CN', false, 'brief'])
  })
})
