import type { ChatEvidencePayload } from '@openchatlab/core'

/**
 * 证据检索工具名。前端不依赖 @openchatlab/tools，这里复刻常量字面量，
 * 与 packages/tools 中 RETRIEVE_CHAT_EVIDENCE_TOOL_NAME 保持一致。
 */
export const RETRIEVE_CHAT_EVIDENCE_TOOL_NAME = 'retrieve_chat_evidence'

export type EvidenceContentBlock = { type: 'evidence'; evidence: ChatEvidencePayload }

export function isEvidenceTool(toolName?: string): boolean {
  return toolName === RETRIEVE_CHAT_EVIDENCE_TOOL_NAME
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEvidencePayload(value: unknown): value is ChatEvidencePayload {
  return isRecord(value) && value.version === 1 && typeof value.query === 'string' && Array.isArray(value.groups)
}

/**
 * 从工具结果中提取证据 payload。
 *
 * 兼容两种形态：adapter 注入后的 `details.evidence`，以及工具原始返回的 `data.evidence`。
 */
export function extractEvidencePayload(toolResult: unknown): ChatEvidencePayload | null {
  if (!isRecord(toolResult)) return null

  const details = isRecord(toolResult.details) ? toolResult.details : null
  if (details && isEvidencePayload(details.evidence)) return details.evidence

  const data = isRecord(toolResult.data) ? toolResult.data : null
  if (data && isEvidencePayload(data.evidence)) return data.evidence

  if (isEvidencePayload(toolResult.evidence)) return toolResult.evidence

  return null
}

export function toEvidenceContentBlock(payload: ChatEvidencePayload): EvidenceContentBlock {
  return { type: 'evidence', evidence: payload }
}
