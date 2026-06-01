/**
 * Token 计数模块
 *
 * 使用 js-tiktoken/lite + cl100k_base 编码进行近似 token 计数。
 * cl100k_base 是 GPT-4 / Claude 系列的近似值，对国内模型有一定误差，
 * 因此阈值计算时预留了余量。
 *
 * 【打包优化】使用 lite 入口 + 动态 import rank 表：
 * - `js-tiktoken/lite` 本身不内联任何 BPE rank 数据（~0KB 额外体积）
 * - rank 表通过动态 import 加载，rollup 会将其拆为独立 chunk，
 *   不再随主进程启动路径同步加载（原方式会内联 ~1MB base64 数据）
 * - 调用 initTokenizer() 完成后，countTokens/countMessagesTokens 使用精确计数；
 *   初始化前的调用会降级到轻量字符估算（误差 <10%，适合"近似"场景）
 */

import { Tiktoken } from 'js-tiktoken/lite'

let encoder: Tiktoken | null = null
let initPromise: Promise<void> | null = null

/**
 * 异步初始化 tokenizer。
 * 应在 AI agent 启动前 await 此函数，确保压缩/预处理路径使用精确计数。
 * 可安全多次调用（幂等）。
 */
export async function initTokenizer(): Promise<void> {
  if (encoder) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const ranks = (await import('js-tiktoken/ranks/cl100k_base')).default
    encoder = new Tiktoken(ranks)
  })()

  return initPromise
}

/**
 * 轻量字符估算（fallback）
 * CJK 字符约 1.6 字符/token，ASCII 约 4 字符/token
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字 + 扩展区 + 假名 + 谚文
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af) ||
      (cp >= 0x3400 && cp <= 0x4dbf)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk / 1.6 + other / 4)
}

/**
 * 计算单段文本的 token 数。
 * encoder 已初始化时使用精确计数，否则降级到字符估算。
 */
export function countTokens(text: string): number {
  if (!text) return 0
  if (encoder) {
    return encoder.encode(text).length
  }
  return estimateTokens(text)
}

/**
 * 计算消息列表的总 token 数（含 systemPrompt）。
 * 每条消息额外计 4 tokens 的格式开销（role + 分隔符）。
 */
export function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
): number {
  let total = 0

  if (systemPrompt) {
    total += countTokens(systemPrompt) + 4
  }

  for (const msg of messages) {
    total += countTokens(msg.content) + 4
  }

  // 回复引导 token
  total += 3

  return total
}
