/**
 * AI Tools 类型定义
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { PreprocessConfig } from '../preprocessor'

export type ToolCategory = 'core' | 'analysis'

export type ToolFactory = (context: ToolContext) => AgentTool<any>

export type TruncationStrategy = 'keep_first' | 'keep_last'

export interface ToolRegistryEntry {
  name: string
  factory: ToolFactory
  category: ToolCategory
  /** 截断策略：keep_first=保留前N条(搜索类), keep_last=保留后N条(时序类) */
  truncationStrategy?: TruncationStrategy
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
  /** 搜索结果上下文：向前取多少条（默认 3） */
  searchContextBefore?: number
  /** 搜索结果上下文：向后取多少条（默认 3） */
  searchContextAfter?: number
  /** 单次工具返回的最大 token 数（基于 context window 动态计算） */
  maxToolResultTokens?: number
}
