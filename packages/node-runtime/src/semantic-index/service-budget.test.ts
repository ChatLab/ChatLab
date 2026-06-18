import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveSearchToolEvidenceTokens } from './service'

describe('resolveSearchToolEvidenceTokens', () => {
  it('defaults semantic search evidence budget to 8000 tokens', () => {
    assert.equal(resolveSearchToolEvidenceTokens(), 8000)
  })

  it('caps semantic search evidence budget by caller tool result budget', () => {
    assert.equal(resolveSearchToolEvidenceTokens(1200), 1200)
    assert.equal(resolveSearchToolEvidenceTokens(100000), 8000)
  })
})
