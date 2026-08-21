import type { CrossChatEvidencePayload } from '@openchatlab/shared-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCrossChatEvidencePayload(value: unknown): value is CrossChatEvidencePayload {
  if (!isRecord(value)) return false
  return (
    value.version === 1 && typeof value.query === 'string' && Array.isArray(value.sources) && isRecord(value.coverage)
  )
}

export function extractCrossChatEvidencePayload(result: unknown): CrossChatEvidencePayload | null {
  if (!isRecord(result)) return null

  const details = isRecord(result.details) ? result.details : null
  if (details && isCrossChatEvidencePayload(details.crossChatEvidence)) return details.crossChatEvidence

  const data = isRecord(result.data) ? result.data : null
  if (data && isCrossChatEvidencePayload(data.crossChatEvidence)) return data.crossChatEvidence

  return isCrossChatEvidencePayload(result.crossChatEvidence) ? result.crossChatEvidence : null
}

export function toCrossChatEvidenceContentBlock(evidence: CrossChatEvidencePayload) {
  return { type: 'cross_chat_evidence' as const, evidence }
}
