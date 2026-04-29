/**
 * Token 计数模块
 * 使用 js-tiktoken 的 cl100k_base 编码进行近似 token 计数。
 * 该编码是 GPT-4/Claude 系列的近似值，对国内模型有一定误差，
 * 因此阈值计算时预留了余量。
 */

import { encodingForModel } from 'js-tiktoken'

let encoder: ReturnType<typeof encodingForModel> | null = null

function getEncoder() {
  if (!encoder) {
    encoder = encodingForModel('gpt-4o')
  }
  return encoder
}

/**
 * 计算单段文本的 token 数
 */
export function countTokens(text: string): number {
  if (!text) return 0
  return getEncoder().encode(text).length
}

/**
 * 计算消息列表的总 token 数（含 systemPrompt）
 * 每条消息额外计 4 tokens 的格式开销（role + 分隔符）
 */
export function countMessagesTokens(messages: Array<{ role: string; content: string }>, systemPrompt?: string): number {
  const enc = getEncoder()
  let total = 0

  if (systemPrompt) {
    total += enc.encode(systemPrompt).length + 4
  }

  for (const msg of messages) {
    total += enc.encode(msg.content).length + 4
  }

  // 回复引导 token
  total += 3

  return total
}
