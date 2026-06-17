import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatEvidencePayload } from '@openchatlab/core'
import {
  RETRIEVE_CHAT_EVIDENCE_TOOL_NAME,
  extractEvidencePayload,
  isEvidencePayload,
  isEvidenceTool,
  toEvidenceContentBlock,
} from './aiChatEvidenceBlocks'

const payload: ChatEvidencePayload = {
  version: 1,
  query: '我们去乐山旅行过多少次？',
  mode: 'hybrid',
  status: 'complete',
  groups: [
    {
      id: 'g1',
      status: 'included',
      title: '乐山行程',
      reason: '提到购票与出发',
      sources: [{ messageId: 12, timestamp: 1_700_000_000_000, snippet: '明天去乐山' }],
    },
  ],
}

describe('aiChatEvidenceBlocks', () => {
  it('identifies the evidence tool by name', () => {
    assert.equal(isEvidenceTool(RETRIEVE_CHAT_EVIDENCE_TOOL_NAME), true)
    assert.equal(isEvidenceTool('search_messages'), false)
    assert.equal(isEvidenceTool(undefined), false)
  })

  it('validates evidence payload shape', () => {
    assert.equal(isEvidencePayload(payload), true)
    assert.equal(isEvidencePayload({ version: 1 }), false)
    assert.equal(isEvidencePayload({ version: 2, query: 'x', groups: [] }), false)
    assert.equal(isEvidencePayload(null), false)
  })

  it('extracts payload from tool result details', () => {
    const result = { content: [{ type: 'text', text: 'ok' }], details: { evidence: payload } }
    assert.deepEqual(extractEvidencePayload(result), payload)
  })

  it('extracts payload from tool result data shape', () => {
    const result = { content: [{ type: 'text', text: 'ok' }], data: { evidence: payload } }
    assert.deepEqual(extractEvidencePayload(result), payload)
  })

  it('returns null when no evidence payload present', () => {
    assert.equal(extractEvidencePayload({ details: { rowCount: 1 } }), null)
    assert.equal(extractEvidencePayload(null), null)
    assert.equal(extractEvidencePayload('error'), null)
  })

  it('wraps payload into an evidence content block', () => {
    assert.deepEqual(toEvidenceContentBlock(payload), { type: 'evidence', evidence: payload })
  })
})
