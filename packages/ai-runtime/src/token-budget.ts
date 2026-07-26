import type { RuntimeContentBlock, RuntimeMessage } from './types'

/** Browser-safe approximation: CJK characters are close to one token; Latin text averages four characters per token. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return 0
  const cjk = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  return Math.max(1, Math.ceil(cjk * 1.15 + (normalized.length - cjk) / 4))
}

export function contentBlockText(
  block: RuntimeContentBlock,
  maxToolResultCharacters = Number.MAX_SAFE_INTEGER
): string {
  if (block.type === 'text' || block.type === 'reasoning') return block.text
  if (block.type !== 'tool' || !block.result) return ''
  return block.result.content.slice(0, maxToolResultCharacters)
}

export function estimateMessageTokens(message: RuntimeMessage, maxToolResultCharacters?: number): number {
  let tokens = estimateTextTokens(message.content) + 4
  for (const block of message.blocks ?? []) {
    tokens += estimateTextTokens(contentBlockText(block, maxToolResultCharacters))
  }
  return tokens
}

export function truncateToolResult(result: string, maxCharacters: number): { content: string; truncated: boolean } {
  if (result.length <= maxCharacters) return { content: result, truncated: false }
  return { content: `${result.slice(0, maxCharacters)}\n[truncated]`, truncated: true }
}
