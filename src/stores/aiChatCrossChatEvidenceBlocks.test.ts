import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatType, type CrossChatEvidencePayload } from '@openchatlab/shared-types'
import { extractCrossChatEvidencePayload, toCrossChatEvidenceContentBlock } from './aiChatCrossChatEvidenceBlocks'

const evidence: CrossChatEvidencePayload = {
  version: 1 as const,
  query: 'project',
  sources: [
    {
      sessionId: 'session-a',
      sessionName: 'Project group',
      sessionType: ChatType.GROUP,
      platform: 'qq',
      messageId: 42,
      senderName: 'Alice',
      timestamp: 1_700_000_000,
      snippet: 'project update',
    },
  ],
  coverage: {
    candidateSessions: 2,
    scannedSessions: 1,
    matchedSessions: 1,
    failedSessions: 0,
    truncated: true,
    truncatedReasons: ['session_budget' as const],
  },
}

test('extracts cross-chat evidence from a tool result and keeps compound source identity', () => {
  const extracted = extractCrossChatEvidencePayload({ data: { crossChatEvidence: evidence } })

  assert.deepEqual(extracted, evidence)
  assert.equal(extracted?.sources[0]?.sessionId, 'session-a')
  assert.equal(extracted?.sources[0]?.messageId, 42)
  assert.deepEqual(toCrossChatEvidenceContentBlock(evidence), {
    type: 'cross_chat_evidence',
    evidence,
  })
})

test('extracts cross-chat evidence from agent adapter details', () => {
  assert.deepEqual(extractCrossChatEvidencePayload({ details: { crossChatEvidence: evidence } }), evidence)
})

test('rejects unrelated or malformed tool results', () => {
  assert.equal(extractCrossChatEvidencePayload(null), null)
  assert.equal(extractCrossChatEvidencePayload({ data: {} }), null)
  assert.equal(extractCrossChatEvidencePayload({ data: { crossChatEvidence: { version: 1, query: 'x' } } }), null)
})
