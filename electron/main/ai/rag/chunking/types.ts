/**
 * 切片相关类型定义
 * 从 ../types.ts 重导出，方便引用
 */

export type { Chunk, ChunkMetadata } from '../types'

/**
 * 需要过滤的无效消息类型
 * 这些消息没有语义价值，会降低 Embedding 质量
 */
export const INVALID_MESSAGE_TYPES = [
  0, // 系统消息
  3, // 图片
  4, // 语音
  5, // 视频
  6, // 文件
  7, // 位置
  8, // 名片
  10, // 撤回消息
  11, // 红包
  12, // 转账
] as const

/**
 * 需要过滤的占位符文本
 */
export const INVALID_TEXT_PATTERNS = [
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
  '撤回了一条消息',
  '你撤回了一条消息',
]

/**
 * 会话消息（从数据库查询）
 */
export interface SessionMessage {
  id: number
  senderName: string
  content: string | null
  timestamp: number
  type?: number
}

/**
 * 会话基本信息
 */
export interface SessionInfo {
  id: number
  startTs: number
  endTs: number
  messageCount: number
}

/**
 * 切片选项
 */
export interface ChunkingOptions {
  /** 最大切片数量 */
  limit?: number

  /** 时间过滤 */
  timeFilter?: {
    startTs: number
    endTs: number
  }

  /** 是否过滤无效消息 */
  filterInvalid?: boolean

  /** 单个切片最大字符数（超过会拆分为子切片） */
  maxChunkChars?: number
}
