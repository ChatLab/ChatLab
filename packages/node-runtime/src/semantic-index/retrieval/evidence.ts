/**
 * 证据块组装
 *
 * chunking-decision-final.md 第 14 节：
 * - RRF 后取 topK 命中 chunk，每个命中在 parent 内前后各扩展若干条消息，不跨 parent。
 * - 相邻命中可合并，但合并后超过单块 soft cap 则拆开注入。
 * - 总证据预算固定 1500 token：不够时优先减少前后扩展，再减少 chunk 数。
 *
 * 消息原文读取（聊天库连接）由注入的 MessageRangeReader 提供，保持模块平台无关、可单测。
 */

import { parseParentBounds } from '../chunker-config'
import { estimateTokens } from '../tokens'

export interface EvidenceMessage {
  id: number
  senderName: string
  content: string
  ts: number
  /** 发送者 id，用于昵称匿名化（U{id}） */
  senderId?: number
  /** 发送者平台 id，用于匿名化时识别 owner */
  senderPlatformId?: string
}

/** 读取聊天库 [startId, endId] 闭区间消息，按 id 升序返回 */
export interface MessageRangeReader {
  readRange(startId: number, endId: number): EvidenceMessage[]
}

/** 命中 chunk（来自 hybridSearch，已按 score 降序） */
export interface EvidenceHit {
  chunkId: string
  score: number
  parentId: string
  startMessageId: number
  endMessageId: number
}

export interface EvidenceBudget {
  /** 总证据预算 token，默认 1500 */
  totalTokens?: number
  /** 单证据块 soft cap token，默认 800 */
  blockSoftCapTokens?: number
  /** 每个命中 chunk 前后各扩展消息条数，默认 3 */
  expandMessages?: number
  /** 最多取多少个命中 chunk，默认 5 */
  maxChunks?: number
}

export interface EvidenceBlock {
  parentId: string
  startMessageId: number
  endMessageId: number
  messages: EvidenceMessage[]
  tokens: number
  /** 该块覆盖的命中 chunkId */
  chunkIds: string[]
  /** 块内最高命中分 */
  score: number
}

export interface EvidenceResult {
  blocks: EvidenceBlock[]
  totalTokens: number
}

/** 证据块规范化文本（用于 token 估算与后续 prompt 注入） */
export function formatEvidenceMessages(messages: EvidenceMessage[]): string {
  return messages.map((m) => `${m.senderName}: ${m.content}`).join('\n')
}

function messagesTokens(messages: EvidenceMessage[]): number {
  return estimateTokens(formatEvidenceMessages(messages))
}

interface WorkingBlock {
  parentId: string
  parentMsgs: EvidenceMessage[]
  startIdx: number
  endIdx: number
  /** 命中核心范围（合并后取并集），收缩扩展时不得越过此范围 */
  coreStartIdx: number
  coreEndIdx: number
  chunkIds: string[]
  score: number
}

export function assembleEvidence(
  reader: MessageRangeReader,
  hits: EvidenceHit[],
  budget: EvidenceBudget = {}
): EvidenceResult {
  const totalTokens = budget.totalTokens ?? 1500
  const softCap = budget.blockSoftCapTokens ?? 800
  const expand = budget.expandMessages ?? 3
  const maxChunks = budget.maxChunks ?? 5

  const selected = hits.slice(0, maxChunks)
  const parentCache = new Map<string, EvidenceMessage[]>()

  // 1. 每个命中在 parent 内扩展为 working block
  const raw: WorkingBlock[] = []
  for (const hit of selected) {
    const bounds = parseParentBounds(hit.parentId)
    if (!bounds) continue
    let parentMsgs = parentCache.get(hit.parentId)
    if (!parentMsgs) {
      parentMsgs = reader.readRange(bounds.startMessageId, bounds.endMessageId)
      parentCache.set(hit.parentId, parentMsgs)
    }
    if (parentMsgs.length === 0) continue

    const coreStartIdx = parentMsgs.findIndex((m) => m.id >= hit.startMessageId)
    let coreEndIdx = -1
    for (let i = parentMsgs.length - 1; i >= 0; i--) {
      if (parentMsgs[i].id <= hit.endMessageId) {
        coreEndIdx = i
        break
      }
    }
    if (coreStartIdx < 0 || coreEndIdx < coreStartIdx) continue

    raw.push({
      parentId: hit.parentId,
      parentMsgs,
      startIdx: Math.max(0, coreStartIdx - expand),
      endIdx: Math.min(parentMsgs.length - 1, coreEndIdx + expand),
      coreStartIdx,
      coreEndIdx,
      chunkIds: [hit.chunkId],
      score: hit.score,
    })
  }

  // 2. 同 parent 内相邻/重叠且合并后不超 soft cap 的块合并
  const byParent = new Map<string, WorkingBlock[]>()
  for (const block of raw) {
    const list = byParent.get(block.parentId) ?? []
    list.push(block)
    byParent.set(block.parentId, list)
  }

  const merged: WorkingBlock[] = []
  for (const list of byParent.values()) {
    list.sort((a, b) => a.startIdx - b.startIdx)
    for (const block of list) {
      const last = merged[merged.length - 1]
      const mergeable = last && last.parentId === block.parentId && block.startIdx <= last.endIdx + 1
      if (mergeable) {
        const candStart = Math.min(last.startIdx, block.startIdx)
        const candEnd = Math.max(last.endIdx, block.endIdx)
        const candTokens = messagesTokens(block.parentMsgs.slice(candStart, candEnd + 1))
        if (candTokens <= softCap) {
          last.startIdx = candStart
          last.endIdx = candEnd
          last.coreStartIdx = Math.min(last.coreStartIdx, block.coreStartIdx)
          last.coreEndIdx = Math.max(last.coreEndIdx, block.coreEndIdx)
          last.chunkIds.push(...block.chunkIds)
          last.score = Math.max(last.score, block.score)
          continue
        }
      }
      merged.push({ ...block })
    }
  }

  // 3. 单块超 soft cap 时收缩扩展（不越过 core）
  for (const block of merged) shrinkToFit(block, softCap)

  // 4. 总预算控制：按 score 降序贪心装入；不够时收缩扩展，再不够则丢弃该块
  merged.sort((a, b) => b.score - a.score)
  const blocks: EvidenceBlock[] = []
  let used = 0
  for (const block of merged) {
    let tokens = messagesTokens(block.parentMsgs.slice(block.startIdx, block.endIdx + 1))
    if (used + tokens > totalTokens) {
      shrinkToFit(block, Math.min(softCap, totalTokens - used))
      tokens = messagesTokens(block.parentMsgs.slice(block.startIdx, block.endIdx + 1))
      if (used + tokens > totalTokens) continue
    }
    const messages = block.parentMsgs.slice(block.startIdx, block.endIdx + 1)
    blocks.push({
      parentId: block.parentId,
      startMessageId: messages[0].id,
      endMessageId: messages[messages.length - 1].id,
      messages,
      tokens,
      chunkIds: block.chunkIds,
      score: block.score,
    })
    used += tokens
  }

  return { blocks, totalTokens: used }
}

/** 收缩扩展使块 token 不超过 cap：从扩展更多的一侧逐条收缩，不越过 core 范围 */
function shrinkToFit(block: WorkingBlock, cap: number): void {
  while (messagesTokens(block.parentMsgs.slice(block.startIdx, block.endIdx + 1)) > cap) {
    const startMargin = block.coreStartIdx - block.startIdx
    const endMargin = block.endIdx - block.coreEndIdx
    if (startMargin <= 0 && endMargin <= 0) break
    if (endMargin >= startMargin) block.endIdx--
    else block.startIdx++
  }
}
