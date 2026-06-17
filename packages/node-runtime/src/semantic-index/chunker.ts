/**
 * Parent/child chunker（纯函数）
 *
 * 实现 chunking-decision-final.md 第 7/8/9/10 节的 Hierarchical Balanced Chunking：
 * - parent：按时间 gap 粗分，超 token 估算上限再拆 sub-parent。
 * - child：parent 内按有效字符滑动，overlap 保留末尾若干条消息。
 * - 语义真空消息：不计有效字符、不进 header、不进 embedding body，但保留在范围与
 *   raw_content_hash 中（证据可读性）。
 * - header：来源 + 时间范围 + 参与者（Contextual Retrieval）。
 *
 * 本模块与具体模型/维度无关；全局 chunk_id 由 warmup 层用 db_path_hash + model_id
 * 组合本模块输出的 localChunkId 得到。
 */

import { createHash } from 'crypto'
import { MessageType } from '@openchatlab/shared-types'
import {
  CHUNKER_VERSION,
  DEFAULT_CHUNKER_CONFIG,
  computeChunkerConfigHash,
  deriveParentId,
  type ChunkerConfig,
} from './chunker-config'
import { estimateTokens } from './tokens'

export interface ChunkMessageInput {
  id: number
  senderName: string
  content: string | null
  /** 毫秒时间戳 */
  ts: number
  /** 平台消息类型（用于识别语义真空类型） */
  type?: number
}

export interface ChunkSource {
  /** 对话名称（群名或私聊对端名） */
  title: string
  kind: 'group' | 'private'
}

export interface ChunkMessagesInput {
  messages: ChunkMessageInput[]
  source: ChunkSource
  config?: ChunkerConfig
}

export interface ChildChunk {
  /** 模型无关的稳定本地 id；全局 chunk_id 由 warmup 组合 db_path_hash + model_id */
  localChunkId: string
  parentId: string
  startMessageId: number
  endMessageId: number
  startTs: number
  endTs: number
  /** 范围内消息总数（含语义真空） */
  messageCount: number
  /** 非真空消息有效字符数 */
  effectiveChars: number
  rawContentHash: string
  embeddingInputHash: string
  /** 送入 embedding 模型的最终文本（header + 非真空 body） */
  embeddingInput: string
}

export interface ChunkResult {
  chunkerVersion: string
  chunkerConfigHash: string
  chunks: ChildChunk[]
  skippedCount: number
  parentCount: number
}

// ==================== 语义真空判定 ====================

/**
 * 语义真空消息类型（canonical MessageType）：媒体/占位/系统类，自身不携带可嵌入文本。
 * TEXT(0) 与 LINK/SHARE/REPLY/FORWARD 等携带文本的类型不在此集合，由内容规则进一步判定。
 */
const VOID_MESSAGE_TYPES = new Set<number>([
  MessageType.IMAGE,
  MessageType.VOICE,
  MessageType.VIDEO,
  MessageType.FILE,
  MessageType.EMOJI,
  MessageType.LOCATION,
  MessageType.RED_PACKET,
  MessageType.TRANSFER,
  MessageType.POKE,
  MessageType.CALL,
  MessageType.CONTACT,
  MessageType.SYSTEM,
  MessageType.RECALL,
])

/** 占位类标签（与平台导出格式匹配，保持原始语言不变） */
const VOID_TEXT_PATTERNS = [
  '[图片]',
  '[语音]',
  '[视频]',
  '[文件]',
  '[表情]',
  '[动画表情]',
  '[位置]',
  '[名片]',
  '[红包]',
  '[转账]',
  '[撤回消息]',
]

const VOID_REVOKE_PATTERNS = ['撤回了一条消息']

/** 短填充语集合（语义真空），变更需 bump CHUNKER_VERSION */
const VOID_FILLERS = new Set([
  '好',
  '好的',
  '好滴',
  '好呀',
  '嗯',
  '嗯嗯',
  '嗯呢',
  '哦',
  '噢',
  '额',
  '呃',
  '哈',
  '哈哈',
  '哈哈哈',
  '呵呵',
  '在',
  '在吗',
  '在么',
  '收到',
  '行',
  '行吧',
  '可以',
  '是',
  '是的',
  '对',
  '对的',
  'ok',
  'okay',
  '👍',
  '👌',
  '🙏',
])

/** 归一化用于填充语匹配：去首尾空白、去末尾标点、英文小写 */
function normalizeFiller(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？、,，~～\s]+$/u, '')
}

export function isSemanticVoid(message: ChunkMessageInput): boolean {
  if (message.type !== undefined && VOID_MESSAGE_TYPES.has(message.type)) return true

  const content = (message.content ?? '').trim()
  if (content.length === 0) return true

  if (VOID_TEXT_PATTERNS.includes(content)) return true
  if (VOID_REVOKE_PATTERNS.some((p) => content.includes(p))) return true

  return VOID_FILLERS.has(normalizeFiller(content))
}

// ==================== 文本与 token 估算 ====================

function effectiveContentOf(message: ChunkMessageInput): string {
  return isSemanticVoid(message) ? '' : (message.content ?? '').trim()
}

function sumEffectiveChars(messages: ChunkMessageInput[]): number {
  let total = 0
  for (const m of messages) total += effectiveContentOf(m).length
  return total
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}

// ==================== header / body ====================

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatTimeRange(startTs: number, endTs: number): string {
  const start = new Date(startTs)
  const end = new Date(endTs)
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  return `${formatDateTime(startTs)} - ${sameDay ? formatTime(endTs) : formatDateTime(endTs)}`
}

function buildEmbeddingInput(source: ChunkSource, messages: ChunkMessageInput[]): string {
  const effective = messages.filter((m) => !isSemanticVoid(m))
  const startTs = messages[0].ts
  const endTs = messages[messages.length - 1].ts

  const lines: string[] = []
  const kindLabel = source.kind === 'group' ? '群聊' : '私聊'
  lines.push(`[来源] ${source.title}（${kindLabel}）`)
  lines.push(`[时间范围] ${formatTimeRange(startTs, endTs)}`)
  if (source.kind === 'group') {
    const participants = [...new Set(effective.map((m) => m.senderName))]
    lines.push(`[参与者] ${participants.join('、')}`)
  }
  lines.push('')
  for (const m of effective) {
    lines.push(`${m.senderName}: ${(m.content ?? '').trim()}`)
  }
  return lines.join('\n')
}

function rawContentHashOf(messages: ChunkMessageInput[]): string {
  return sha256Hex(messages.map((m) => `${m.id}:${m.content ?? ''}`).join('\n'))
}

// ==================== parent / child 切分 ====================

function segmentParents(messages: ChunkMessageInput[], config: ChunkerConfig): ChunkMessageInput[][] {
  const parents: ChunkMessageInput[][] = []
  let current: ChunkMessageInput[] = []
  const gapMs = config.parentGapSeconds * 1000

  for (const m of messages) {
    if (current.length === 0) {
      current.push(m)
      continue
    }
    const prev = current[current.length - 1]
    const overGap = m.ts - prev.ts > gapMs
    const overTokens = estimateTokens(current.map((x) => (x.content ?? '').trim()).join('\n')) >= config.parentMaxTokens
    if (overGap || overTokens) {
      parents.push(current)
      current = [m]
    } else {
      current.push(m)
    }
  }
  if (current.length > 0) parents.push(current)
  return parents
}

function buildChildDrafts(parent: ChunkMessageInput[], config: ChunkerConfig): ChunkMessageInput[][] {
  const drafts: ChunkMessageInput[][] = []
  let current: ChunkMessageInput[] = []
  let newCount = 0

  const closeAndSeed = () => {
    drafts.push(current)
    const seed = config.overlapMessages > 0 ? current.slice(-config.overlapMessages) : []
    current = [...seed]
    newCount = 0
  }

  for (const m of parent) {
    current.push(m)
    newCount++
    const effectiveChars = sumEffectiveChars(current)
    const messageCount = current.length
    const overChars = effectiveChars >= config.childTargetMaxChars
    const overTokens = estimateTokens(current.map((x) => effectiveContentOf(x)).join('\n')) >= config.childHardMaxTokens
    // 消息数软上限：高频短消息群聊里，攒够消息数且有效字符达标即关闭，避免单 chunk 混入过多消息
    const overSoftMessages = messageCount >= config.childSoftMaxMessages && effectiveChars >= config.childTargetMinChars
    // 消息数硬上限：即使有效字符不足 min 也强制关闭，避免极端短消息无限堆积
    const overHardMessages = messageCount >= config.childHardMaxMessages
    if (overChars || overTokens || overSoftMessages || overHardMessages) closeAndSeed()
  }

  // flush：仅当还有新消息（避免重复上一个 child 的 overlap 尾巴）
  if (current.length > 0 && (newCount > 0 || drafts.length === 0)) {
    drafts.push(current)
  }
  return drafts
}

export function chunkMessages(input: ChunkMessagesInput): ChunkResult {
  const config = input.config ?? DEFAULT_CHUNKER_CONFIG
  const chunkerConfigHash = computeChunkerConfigHash(config)

  const parents = segmentParents(input.messages, config)
  const chunks: ChildChunk[] = []
  let skippedCount = 0

  for (const parent of parents) {
    const parentId = deriveParentId({
      startMessageId: parent[0].id,
      endMessageId: parent[parent.length - 1].id,
      gapSeconds: config.parentGapSeconds,
      chunkerVersion: CHUNKER_VERSION,
      chunkerConfigHash,
    })

    for (const draft of buildChildDrafts(parent, config)) {
      const effectiveChars = sumEffectiveChars(draft)
      if (effectiveChars < config.semanticVoidSkipThreshold) {
        skippedCount++
        continue
      }
      const startMessageId = draft[0].id
      const endMessageId = draft[draft.length - 1].id
      const embeddingInput = buildEmbeddingInput(input.source, draft)
      chunks.push({
        localChunkId: `${parentId}#${startMessageId}-${endMessageId}`,
        parentId,
        startMessageId,
        endMessageId,
        startTs: draft[0].ts,
        endTs: draft[draft.length - 1].ts,
        messageCount: draft.length,
        effectiveChars,
        rawContentHash: rawContentHashOf(draft),
        embeddingInputHash: sha256Hex(embeddingInput),
        embeddingInput,
      })
    }
  }

  return { chunkerVersion: CHUNKER_VERSION, chunkerConfigHash, chunks, skippedCount, parentCount: parents.length }
}
