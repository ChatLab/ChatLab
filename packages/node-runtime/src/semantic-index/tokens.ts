/**
 * token 粗略估算（共享）
 *
 * 仅作硬上限护栏与证据预算控制，真实 token 由 embedder / LLM 决定。
 * 估算规则：CJK 每字约 1 token，其余字符约 1/4 token。
 */
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
 * 按共享估算规则截断文本，确保单条超长消息不会绕过 chunk token 硬上限。
 * 这里只处理送给 embedding provider 的派生文本，不修改原始消息和证据范围。
 */
export function clampEstimatedTokens(text: string, maxTokens: number): string {
  const limit = Math.max(0, Math.floor(maxTokens))
  if (limit === 0) return ''
  if (estimateTokens(text) <= limit) return text

  let cjk = 0
  let other = 0
  let end = 0
  for (const char of text) {
    if (isCjkCharacter(char)) cjk++
    else other++
    if (cjk + Math.ceil(other / 4) > limit) break
    end += char.length
  }
  return text.slice(0, end)
}
