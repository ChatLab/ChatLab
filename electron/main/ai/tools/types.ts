/**
 * AI Tools 类型定义
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { PreprocessConfig } from '../preprocessor'

export type ToolCategory = 'core' | 'analysis'

export type ToolFactory = (context: ToolContext) => AgentTool<any>

export interface ToolRegistryEntry {
  name: string
  factory: ToolFactory
  category: ToolCategory
}

/** Owner 信息（当前用户在对话中的身份） */
export interface OwnerInfo {
  /** Owner 的 platformId */
  platformId: string
  /** Owner 的显示名称 */
  displayName: string
}

/**
 * 工具执行上下文
 * 包含执行工具时需要的所有上下文信息
 */
export interface ToolContext {
  /** 当前会话 ID（数据库文件名） */
  sessionId: string
  /** 当前 AI 对话 ID（用于上下文管理隔离） */
  conversationId?: string
  /** 时间过滤器 */
  timeFilter?: {
    startTs: number
    endTs: number
  }
  /** 用户配置的消息条数限制（工具获取消息时使用） */
  maxMessagesLimit?: number
  /** Owner 信息（当前用户在对话中的身份） */
  ownerInfo?: OwnerInfo
  /** 本轮显式 @ 的成员 */
  mentionedMembers?: Array<{
    memberId: number
    platformId: string
    displayName: string
    aliases: string[]
    mentionText: string
  }>
  /** 语言环境（用于工具返回结果的国际化） */
  locale?: string
  /** 聊天记录预处理配置（全局） */
  preprocessConfig?: PreprocessConfig
}
