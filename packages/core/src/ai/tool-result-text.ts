/**
 * Tool result text extraction and truncation.
 *
 * Tool results are persisted (truncated) into assistant message content blocks
 * so later turns can replay them as real toolCall/toolResult message pairs,
 * keeping the model grounded in what it actually retrieved.
 */

/**
 * Max characters of a single tool result persisted into a content block.
 * Bounds both DB row size and the per-result token cost when history is replayed.
 */
export const MAX_PERSISTED_TOOL_RESULT_CHARS = 4000

const TRUNCATION_MARKER = '\n…[truncated]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract the text the model saw from an AgentToolResult-shaped value
 * (`{ content: [{ type: 'text', text }], details? }`). Non-text parts are skipped.
 */
export function extractToolResultText(toolResult: unknown): string {
  if (!isRecord(toolResult)) return ''
  if (!Array.isArray(toolResult.content)) return ''
  return toolResult.content
    .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter((text) => text.length > 0)
    .join('\n')
}

export function truncateToolResultText(text: string, maxChars: number = MAX_PERSISTED_TOOL_RESULT_CHARS): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + TRUNCATION_MARKER
}
