/**
 * ChatLab 基础类型定义
 * 包含：枚举、数据库模型、Parser 解析结果
 *
 * 核心类型已迁移到 @openchatlab/shared-types，此处 re-export 保持兼容
 */

import { MessageType, ChatType, KNOWN_PLATFORMS, STANDARD_ROLE_IDS } from '@openchatlab/shared-types'

import type { TimeFilter, ChatPlatform, MemberRole, ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

// Re-export all shared types for backward compatibility
export { MessageType, ChatType, KNOWN_PLATFORMS, STANDARD_ROLE_IDS }

export type { TimeFilter, ChatPlatform, MemberRole, ParsedMember, ParsedMessage }

/**
 * 消息类型 i18n key 映射
 */
const MESSAGE_TYPE_KEYS: Record<number, string> = {
  [MessageType.TEXT]: 'text',
  [MessageType.IMAGE]: 'image',
  [MessageType.VOICE]: 'voice',
  [MessageType.VIDEO]: 'video',
  [MessageType.FILE]: 'file',
  [MessageType.EMOJI]: 'emoji',
  [MessageType.LINK]: 'link',
  [MessageType.LOCATION]: 'location',
  [MessageType.RED_PACKET]: 'redPacket',
  [MessageType.TRANSFER]: 'transfer',
  [MessageType.POKE]: 'poke',
  [MessageType.CALL]: 'call',
  [MessageType.SHARE]: 'share',
  [MessageType.REPLY]: 'reply',
  [MessageType.FORWARD]: 'forward',
  [MessageType.CONTACT]: 'contact',
  [MessageType.SYSTEM]: 'system',
  [MessageType.RECALL]: 'recall',
  [MessageType.OTHER]: 'other',
}

/**
 * 获取消息类型名称
 * @param type 消息类型
 * @param t 可选的 i18n t 函数，传入时使用 common.messageType.* 键
 */
export function getMessageTypeName(type: MessageType | number, t?: (key: string) => string): string {
  const key = MESSAGE_TYPE_KEYS[type]
  if (t && key) return t(`common.messageType.${key}`)
  return t ? t('common.messageType.unknown') : '未知'
}

// ==================== 数据库模型 ====================

/**
 * 元信息（数据库中存储的格式）
 */
export interface DbMeta {
  name: string // 群名/对话名
  platform: ChatPlatform // 平台
  type: ChatType // 聊天类型
  imported_at: number // 导入时间戳（秒）
  group_id: string | null // 群ID（群聊类型有值，私聊为空）
  group_avatar: string | null // 群头像（base64 Data URL）
  owner_id: string | null // 所有者/导出者的 platformId
  session_gap_threshold: number | null // 会话切分阈值（秒），null 表示使用全局配置
}

/**
 * 成员（数据库中存储的格式）
 */
export interface DbMember {
  id: number // 自增ID
  platform_id: string // 平台标识
  account_name: string | null // 账号名称（原始昵称 sendNickName）
  group_nickname: string | null // 群昵称（sendMemberName，可为空）
  aliases: string // 用户自定义别名（JSON数组格式）
  avatar: string | null // 头像（base64 Data URL）
  roles: string // 成员角色（JSON数组格式，如 '[{"id":"owner"}]'）
}

/**
 * 消息（数据库中存储的格式）
 */
export interface DbMessage {
  id: number // 自增ID
  sender_id: number // FK -> member.id
  sender_account_name: string | null // 发送时的账号名称
  sender_group_nickname: string | null // 发送时的群昵称
  ts: number // 时间戳（秒）
  type: MessageType // 消息类型
  content: string | null // 纯文本内容
  reply_to_message_id: string | null // 回复的目标消息 ID（平台原始 ID）
}

// ==================== Parser 解析结果 ====================

/**
 * Parser 解析结果
 */
export interface ParseResult {
  meta: {
    name: string
    platform: ChatPlatform
    type: ChatType
    groupId?: string
    groupAvatar?: string
    ownerId?: string
  }
  members: ParsedMember[]
  messages: ParsedMessage[]
}

// ==================== 会话与 IPC 类型 ====================

/**
 * 分析会话信息（用于会话列表展示）
 */
export interface AnalysisSession {
  id: string // 数据库文件名（不含扩展名）
  name: string // 群名/对话名
  platform: ChatPlatform
  type: ChatType
  importedAt: number // 导入时间戳
  messageCount: number // 消息总数
  memberCount: number // 成员数
  dbPath: string // 数据库文件完整路径
  groupId: string | null // 群ID（群聊类型有值，私聊为空）
  groupAvatar: string | null // 群头像（base64 Data URL）
  ownerId: string | null // 所有者/导出者的 platformId
  memberAvatar: string | null // 私聊对方头像（base64 Data URL）
  lastMessageTs: number | null // 最后一条消息时间戳（秒）
  summaryCount: number // 已生成摘要的会话片段数
  aiConversationCount: number // AI 对话数
}

/**
 * 导入进度回调
 */
export interface ImportProgress {
  stage: 'detecting' | 'reading' | 'parsing' | 'saving' | 'indexing' | 'done' | 'error'
  progress: number // 0-100
  message?: string
  // 流式解析额外字段
  bytesRead?: number
  totalBytes?: number
  messagesProcessed?: number
}

/**
 * 导出进度
 */
export interface ExportProgress {
  stage: 'preparing' | 'exporting' | 'done' | 'error'
  currentBlock: number
  totalBlocks: number
  percentage: number // 0-100
  message: string
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean
  sessionId?: string // 成功时返回会话ID
  error?: string // 失败时返回错误信息
}

// ==================== 会话索引类型 ====================

/**
 * 会话（时间切分的对话段落）
 */
export interface ChatSession {
  id: number // 自增ID
  startTs: number // 会话开始时间戳（秒）
  endTs: number // 会话结束时间戳（秒）
  messageCount: number // 该会话包含的消息数
  isManual: boolean // 是否用户手动合并/修改过
  summary: string | null // AI 生成的会话简报（预留）
}

/**
 * 消息上下文索引
 */
export interface MessageContext {
  messageId: number // 关联 message.id
  sessionId: number // 关联 segment.id
  topicId: number | null // 关联 chat_topic.id（预留）
}

/**
 * 会话索引配置
 */
export interface SessionConfig {
  /** 默认切分阈值（秒） */
  defaultGapThreshold: number
}

/**
 * 会话统计信息
 */
export interface SessionStats {
  /** 会话总数 */
  sessionCount: number
  /** 是否已生成会话索引 */
  hasIndex: boolean
  /** 当前使用的阈值（秒） */
  gapThreshold: number
}
