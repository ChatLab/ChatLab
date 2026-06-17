/**
 * token 粗略估算（共享）
 *
 * 仅作硬上限护栏与证据预算控制，真实 token 由 embedder / LLM 决定。
 * 估算规则：CJK 每字约 1 token，其余字符约 1/4 token。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(ch)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}
