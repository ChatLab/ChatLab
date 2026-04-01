/**
 * ChatLab 格式类型定义
 * 包含：ChatLab 专属格式、合并相关、聊天记录查看器
 */

import type { ChatPlatform, ChatType, MessageType, MemberRole } from './base'

// ==================== ChatLab 专属格式类型 ====================

/**
 * ChatLab 格式版本信息
 */
export interface ChatLabHeader {
  version: string // 格式版本，如 "0.0.1"
  exportedAt: number // 导出时间戳（秒）
  generator?: string // 生成工具名称（可选）
  description?: string // 描述信息（可选，自定义内容）
}

/**
 * 合并来源信息
 */
export interface MergeSource {
  filename: string // 原文件名
  platform?: string // 原平台
  messageCount: number // 消息数量
}

/**
 * ChatLab 格式的元信息
 */
export interface ChatLabMeta {
  name: string // 群名/对话名
  platform: ChatPlatform // 平台（合并时为 mixed）
  type: ChatType // 聊天类型
  sources?: MergeSource[] // 合并来源（可选）
  groupId?: string // 群ID（可选，仅群聊）
  groupAvatar?: string // 群头像（base64 Data URL，可选）
  ownerId?: string // 所有者/导出者的 platformId（可选）
}

/**
 * ChatLab 格式的成员
 */
export interface ChatLabMember {
  platformId: string // 平台标识
  accountName: string // 账号名称
  groupNickname?: string // 群昵称（可选）
  aliases?: string[] // 用户自定义别名（可选）
  avatar?: string // 头像（base64 Data URL，可选）
  roles?: MemberRole[] // 成员角色（可选，可多个）
}

/**
 * ChatLab 格式的消息
 */
export interface ChatLabMessage {
  sender: string // 发送者 platformId
  accountName: string // 发送时的账号名称
  groupNickname?: string // 发送时的群昵称（可选）
  timestamp: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 内容
}

/**
 * ChatLab 专属格式文件结构
 */
export interface ChatLabFormat {
  chatlab: ChatLabHeader
  meta: ChatLabMeta
  members: ChatLabMember[]
  messages: ChatLabMessage[]
}

// ==================== 合并相关类型 ====================

/**
 * 文件解析信息（用于合并前预览）
 */
export interface FileParseInfo {
  name: string // 群名
  format: string // 格式名称
  platform: string // 平台
  messageCount: number // 消息数量
  memberCount: number // 成员数量
  fileSize?: number // 文件大小（字节）
}

/**
 * 合并冲突项
 */
export interface MergeConflict {
  id: string // 冲突ID
  timestamp: number // 时间戳
  sender: string // 发送者
  contentLength1: number // 内容1长度
  contentLength2: number // 内容2长度
  content1: string // 内容1
  content2: string // 内容2
}

/**
 * 冲突检测结果
 */
export interface ConflictCheckResult {
  conflicts: MergeConflict[]
  totalMessages: number // 合并后预计消息数
}

/**
 * 冲突解决方案
 */
export interface ConflictResolution {
  id: string
  resolution: 'keep1' | 'keep2' | 'keepBoth'
}

/**
 * 输出格式类型
 */
export type OutputFormat = 'json' | 'jsonl'

/**
 * 合并参数
 */
export interface MergeParams {
  filePaths: string[]
  outputName: string
  outputDir?: string
  outputFormat?: OutputFormat // 输出格式，默认 'json'
  conflictResolutions: ConflictResolution[]
  andAnalyze: boolean
}

/**
 * 合并结果
 */
export interface MergeResult {
  success: boolean
  outputPath?: string
  sessionId?: string // 如果选择了分析，返回会话ID
  error?: string
}

// ==================== 聊天记录查看器类型 ====================

/**
 * 聊天记录查看器查询参数
 * 支持组合查询：多个条件可同时生效
 */
export interface ChatRecordQuery {
  /** 定位到指定消息（初始加载时以此消息为中心） */
  scrollToMessageId?: number

  /** 成员筛选：只显示该成员的消息 */
  memberId?: number
  /** 成员名称（用于显示） */
  memberName?: string

  /** 时间范围筛选：开始时间戳（秒） */
  startTs?: number
  /** 时间范围筛选：结束时间戳（秒） */
  endTs?: number

  /** 关键词搜索（OR 逻辑） */
  keywords?: string[]

  /** 高亮关键词（用于 UI 高亮显示） */
  highlightKeywords?: string[]
}

/**
 * 聊天记录查看器中的消息项
 */
export interface ChatRecordMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null // 发送者头像
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null // 回复的目标消息 ID（平台原始 ID）
  replyToContent: string | null // 被回复消息的内容预览
  replyToSenderName: string | null // 被回复消息的发送者名称
}
