/**
 * Chunker 版本、运行时参数与 hash 派生（纯函数）
 *
 * 设计依据 chunking-decision-final.md 第 7/8/9/11 节：
 * - chunker_version 是代码常量，算法/格式语义变化时 bump，触发全量重建。
 * - chunker_config_hash 由运行时参数生成，参数变化只影响当前索引。
 * - parent_id 必须包含 config hash，避免错误复用旧 parent 缓存。
 * - db_path_hash 用于在 embedding_index.db 中区分不同聊天库。
 */

import { createHash } from 'crypto'

/**
 * Chunker 算法/格式语义版本。
 *
 * bump 条件（见文档第 11 节）：
 * - header 模板结构变化。
 * - 切片算法语义变化。
 * - 语义真空过滤规则本身变化。
 */
export const CHUNKER_VERSION = 'v1.2'

/** Phase 1 固定策略标识 */
export const STRATEGY_ID = 'balanced'

/** 运行时 chunker 参数（进入 chunker_config_hash） */
export interface ChunkerConfig {
  /** parent 时间 gap 阈值（秒），兜底 1800 */
  parentGapSeconds: number
  /** parent token 硬上限 */
  parentMaxTokens: number
  /** child 目标最小有效字符：达到消息数软上限时仍需满足此下限才关闭，避免 header 主导的过短 chunk */
  childTargetMinChars: number
  /** child 目标最大有效字符 */
  childTargetMaxChars: number
  /** child 消息数软上限：消息数达到且有效字符达到 min 时关闭（应对高频短消息群聊） */
  childSoftMaxMessages: number
  /** child 消息数硬上限：消息数达到即强制关闭，即使有效字符不足 min */
  childHardMaxMessages: number
  /** child token 硬上限 */
  childHardMaxTokens: number
  /** overlap 保留末尾消息条数 */
  overlapMessages: number
  /** 过滤语义真空后有效字符低于该值的 chunk 跳过索引 */
  semanticVoidSkipThreshold: number
}

/**
 * Phase 1 默认 chunker 参数（见决策表）。
 * 短 chunk + 多候选策略：缩短 child 窗口提升语义定位精度，配合检索侧更高 max_results
 * 与 evidence/token 预算控制最终注入量。
 */
export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  parentGapSeconds: 1800,
  parentMaxTokens: 2000,
  childTargetMinChars: 120,
  childTargetMaxChars: 360,
  childSoftMaxMessages: 12,
  childHardMaxMessages: 20,
  childHardMaxTokens: 1200,
  overlapMessages: 2,
  semanticVoidSkipThreshold: 20,
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}

/**
 * 运行时参数 hash。显式按固定字段顺序序列化，确保与传入对象的键顺序无关。
 */
export function computeChunkerConfigHash(config: ChunkerConfig): string {
  const canonical = JSON.stringify({
    parentGapSeconds: config.parentGapSeconds,
    parentMaxTokens: config.parentMaxTokens,
    childTargetMinChars: config.childTargetMinChars,
    childTargetMaxChars: config.childTargetMaxChars,
    childSoftMaxMessages: config.childSoftMaxMessages,
    childHardMaxMessages: config.childHardMaxMessages,
    childHardMaxTokens: config.childHardMaxTokens,
    overlapMessages: config.overlapMessages,
    semanticVoidSkipThreshold: config.semanticVoidSkipThreshold,
  })
  return sha256Hex(canonical)
}

/** 聊天数据库文件路径的 SHA256 前缀，用于区分不同聊天库的 chunk */
export function computeDbPathHash(dbPath: string): string {
  return sha256Hex(dbPath).slice(0, 16)
}

/**
 * 组合全局唯一 chunk_id。chunker 输出模型无关的 localChunkId，写入存储时由
 * db_path_hash + model_id 组合成跨对话、跨模型唯一的 chunk_id。
 */
export function composeChunkId(dbPathHash: string, modelId: string, localChunkId: string): string {
  return `${dbPathHash}:${modelId}:${localChunkId}`
}

/**
 * 稳定派生 parent id。包含 config hash，参数变化后 parent id 也变化。
 * 格式：`parent:${start}:${end}:${gap}:${version}:${configHash}`
 */
export function deriveParentId(params: {
  startMessageId: number
  endMessageId: number
  gapSeconds: number
  chunkerVersion: string
  chunkerConfigHash: string
}): string {
  return `parent:${params.startMessageId}:${params.endMessageId}:${params.gapSeconds}:${params.chunkerVersion}:${params.chunkerConfigHash}`
}

/**
 * 从 parent id 解析 parent 的消息 id 边界，用于证据扩展时限定"不跨 parent"。
 * 格式不匹配时返回 null。
 */
export function parseParentBounds(parentId: string): { startMessageId: number; endMessageId: number } | null {
  const segments = parentId.split(':')
  if (segments.length < 3 || segments[0] !== 'parent') return null
  const startMessageId = Number(segments[1])
  const endMessageId = Number(segments[2])
  if (!Number.isFinite(startMessageId) || !Number.isFinite(endMessageId)) return null
  return { startMessageId, endMessageId }
}
