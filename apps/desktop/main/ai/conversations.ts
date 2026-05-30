/**
 * AI 对话历史管理模块（Electron 薄包装层）
 *
 * 委托给 @openchatlab/node-runtime 的 AIConversationManager，
 * 保留原有的模块级函数签名以兼容现有 IPC 调用。
 */

import { AIConversationManager } from '@openchatlab/node-runtime'
import { getPathProvider } from '../path-context'
import { aiLogger } from './logger'

export type { AIConversation, AIMessage, AIMessageRole, ContentBlock, TokenUsageData } from '@openchatlab/node-runtime'

let manager: AIConversationManager | null = null

export function getManager(): AIConversationManager {
  if (!manager) {
    manager = new AIConversationManager(getPathProvider().getAiDataDir(), {
      logger: {
        warn(category, message, extra) {
          aiLogger.warn(category, message, extra)
        },
      },
    })
  }
  return manager
}

export function closeAiDatabase(): void {
  if (manager) {
    manager.close()
    manager = null
  }
}

export function getAiSchema() {
  return getManager().getAiSchema()
}

export function executeAiSQL(sql: string) {
  return getManager().executeAiSQL(sql)
}

export function createConversation(sessionId: string, title: string | undefined, assistantId: string) {
  return getManager().createConversation(sessionId, title, assistantId)
}

export function getConversationCountsBySession() {
  return getManager().getConversationCountsBySession()
}

export function getConversations(sessionId: string) {
  return getManager().getConversations(sessionId)
}

export function getConversation(conversationId: string) {
  return getManager().getConversation(conversationId)
}

export function updateConversationTitle(conversationId: string, title: string) {
  return getManager().updateConversationTitle(conversationId, title)
}

export function deleteConversation(conversationId: string) {
  return getManager().deleteConversation(conversationId)
}

export function addMessage(
  conversationId: string,
  role: import('@openchatlab/node-runtime').AIMessageRole,
  content: string,
  dataKeywords?: string[],
  dataMessageCount?: number,
  contentBlocks?: import('@openchatlab/node-runtime').ContentBlock[],
  tokenUsage?: import('@openchatlab/node-runtime').TokenUsageData
) {
  return getManager().addMessage(
    conversationId,
    role,
    content,
    dataKeywords,
    dataMessageCount,
    contentBlocks,
    tokenUsage
  )
}

export function getMessages(conversationId: string) {
  return getManager().getMessages(conversationId)
}

export function deleteMessage(messageId: string) {
  return getManager().deleteMessage(messageId)
}

export function deleteMessagesFrom(conversationId: string, messageId: string) {
  return getManager().deleteMessagesFrom(conversationId, messageId)
}

export function forkConversation(sourceConversationId: string, upToMessageId: string, title?: string) {
  return getManager().forkConversation(sourceConversationId, upToMessageId, title)
}

export function updateMessageContent(messageId: string, newContent: string) {
  return getManager().updateMessageContent(messageId, newContent)
}

export function deleteAndRelinkMessage(conversationId: string, messageId: string) {
  return getManager().deleteAndRelinkMessage(conversationId, messageId)
}

export function insertMessageAfter(
  conversationId: string,
  afterMessageId: string,
  role: import('@openchatlab/node-runtime').AIMessageRole,
  content: string,
  contentBlocks?: import('@openchatlab/node-runtime').ContentBlock[],
  tokenUsage?: import('@openchatlab/node-runtime').TokenUsageData
) {
  return getManager().insertMessageAfter(conversationId, afterMessageId, role, content, contentBlocks, tokenUsage)
}

export function setPendingDebugContext(conversationId: string, debugContext: string) {
  return getManager().setPendingDebugContext(conversationId, debugContext)
}

export function setDebugContext(messageId: string, debugContext: string) {
  return getManager().setDebugContext(messageId, debugContext)
}

export function clearAllDebugContext() {
  return getManager().clearAllDebugContext()
}

export function getConversationTokenUsage(conversationId: string) {
  return getManager().getConversationTokenUsage(conversationId)
}

export function getHistoryForAgent(conversationId: string, maxMessages?: number, leafMessageId?: string | null) {
  return getManager().getHistoryForAgent(conversationId, maxMessages, leafMessageId)
}

export function addSummaryMessage(
  conversationId: string,
  content: string,
  meta: { bufferBoundaryTimestamp: number; compressedMessageCount: number }
) {
  return getManager().addSummaryMessage(conversationId, content, meta)
}

export function getLatestSummary(conversationId: string) {
  return getManager().getLatestSummary(conversationId)
}

export function getMessagesAfterSummary(conversationId: string, summaryTimestamp: number) {
  return getManager().getMessagesAfterSummary(conversationId, summaryTimestamp)
}

export function getAllUserAssistantMessages(conversationId: string) {
  return getManager().getAllUserAssistantMessages(conversationId)
}

export function getMessageCountAfterSummary(conversationId: string) {
  return getManager().getMessageCountAfterSummary(conversationId)
}
