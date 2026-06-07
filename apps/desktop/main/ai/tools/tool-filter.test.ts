import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { isAnalysisToolAllowed } from './tool-filter'

describe('Electron analysis tool filtering', () => {
  it('keeps analysis tools opt-in when no allowlist is configured', () => {
    assert.equal(isAnalysisToolAllowed('keyword_frequency', undefined), false)
    assert.equal(isAnalysisToolAllowed('keyword_frequency', []), false)
  })

  it('allows only explicitly listed analysis tools', () => {
    assert.equal(isAnalysisToolAllowed('keyword_frequency', ['keyword_frequency']), true)
    assert.equal(isAnalysisToolAllowed('execute_sql', ['keyword_frequency']), false)
  })

  it('accepts legacy session tool names in assistant allowlists', () => {
    assert.equal(isAnalysisToolAllowed('get_segment_summaries', ['get_session_summaries']), true)
  })
})
