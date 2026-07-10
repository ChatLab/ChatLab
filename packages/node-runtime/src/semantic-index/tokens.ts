/**
 * token 粗略估算（共享）
 *
 * 仅作硬上限护栏与证据预算控制，真实 token 由 embedder / LLM 决定。
 * 估算规则：CJK 每字约 1 token，其余字符约 1/4 token。
 */
import { Buffer } from 'node:buffer'

const UTF8_BYTES_PER_ESTIMATED_TOKEN = 4

function isCjkCharacter(char: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(char)
}

export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (isCjkCharacter(ch)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 按共享估算规则与 UTF-8 字节上限截断文本，避免 emoji 等高膨胀字符绕过安全护栏。
 * 这里只处理送给 embedding provider 的派生文本，不修改原始消息和证据范围。
 */
export function clampEstimatedTokens(text: string, maxTokens: number): string {
  const limit = Math.max(0, Math.floor(maxTokens))
  if (limit === 0) return ''
  const byteLimit = limit * UTF8_BYTES_PER_ESTIMATED_TOKEN
  if (estimateTokens(text) <= limit && Buffer.byteLength(text, 'utf8') <= byteLimit) return text

  let cjk = 0
  let other = 0
  let bytes = 0
  let end = 0
  for (const char of text) {
    const isCjk = isCjkCharacter(char)
    const nextCjk = cjk + (isCjk ? 1 : 0)
    const nextOther = other + (isCjk ? 0 : 1)
    const nextBytes = bytes + Buffer.byteLength(char, 'utf8')
    if (nextCjk + Math.ceil(nextOther / 4) > limit || nextBytes > byteLimit) break
    cjk = nextCjk
    other = nextOther
    bytes = nextBytes
    end += char.length
  }
  return text.slice(0, end)
}
