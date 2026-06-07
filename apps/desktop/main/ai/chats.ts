/**
 * AI 聊天历史管理模块（Electron 薄包装层）
 *
 * 委托给 @openchatlab/node-runtime 的 AIChatManager，
 * 保留原有的模块级函数签名以兼容现有 IPC 调用。
 */

import { AIChatManager } from '@openchatlab/node-runtime'
import { getPathProvider } from '../path-context'
import { aiLogger } from './logger'

export type { AIChat, AIMessage, AIMessageRole, ContentBlock, TokenUsageData } from '@openchatlab/node-runtime'

let manager: AIChatManager | null = null

export function getManager(): AIChatManager {
  if (!manager) {
    manager = new AIChatManager(getPathProvider().getAiDataDir(), {
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

export function createAIChat(sessionId: string, title: string | undefined, assistantId: string) {
  return getManager().createAIChat(sessionId, title, assistantId)
}

export function getAIChatCountsBySession() {
  return getManager().getAIChatCountsBySession()
}

export function getAIChats(sessionId: string) {
  return getManager().getAIChats(sessionId)
}

export function getAIChat(aiChatId: string) {
  return getManager().getAIChat(aiChatId)
}

export function updateAIChatTitle(aiChatId: string, title: string) {
  return getManager().updateAIChatTitle(aiChatId, title)
}

export function deleteAIChat(aiChatId: string) {
  return getManager().deleteAIChat(aiChatId)
}

export function addMessage(
  aiChatId: string,
  role: import('@openchatlab/node-runtime').AIMessageRole,
  content: string,
  dataKeywords?: string[],
  dataMessageCount?: number,
  contentBlocks?: import('@openchatlab/node-runtime').ContentBlock[],
  tokenUsage?: import('@openchatlab/node-runtime').TokenUsageData
) {
  return getManager().addMessage(
    aiChatId,
    role,
    content,
    dataKeywords,
    dataMessageCount,
    contentBlocks,
    tokenUsage
  )
}

export function getMessages(aiChatId: string) {
  return getManager().getMessages(aiChatId)
}

export function deleteMessage(messageId: string) {
  return getManager().deleteMessage(messageId)
}

export function deleteMessagesFrom(aiChatId: string, messageId: string) {
  return getManager().deleteMessagesFrom(aiChatId, messageId)
}

export function forkAIChat(sourceAIChatId: string, upToMessageId: string, title?: string) {
  return getManager().forkAIChat(sourceAIChatId, upToMessageId, title)
}

export function updateMessageContent(messageId: string, newContent: string) {
  return getManager().updateMessageContent(messageId, newContent)
}

export function deleteAndRelinkMessage(aiChatId: string, messageId: string) {
  return getManager().deleteAndRelinkMessage(aiChatId, messageId)
}

export function insertMessageAfter(
  aiChatId: string,
  afterMessageId: string,
  role: import('@openchatlab/node-runtime').AIMessageRole,
  content: string,
  contentBlocks?: import('@openchatlab/node-runtime').ContentBlock[],
  tokenUsage?: import('@openchatlab/node-runtime').TokenUsageData
) {
  return getManager().insertMessageAfter(aiChatId, afterMessageId, role, content, contentBlocks, tokenUsage)
}

export function setPendingDebugContext(aiChatId: string, debugContext: string) {
  return getManager().setPendingDebugContext(aiChatId, debugContext)
}

export function setDebugContext(messageId: string, debugContext: string) {
  return getManager().setDebugContext(messageId, debugContext)
}

export function clearAllDebugContext() {
  return getManager().clearAllDebugContext()
}

export function getAIChatTokenUsage(aiChatId: string) {
  return getManager().getAIChatTokenUsage(aiChatId)
}

export function getHistoryForAgent(aiChatId: string, maxMessages?: number, leafMessageId?: string | null) {
  return getManager().getHistoryForAgent(aiChatId, maxMessages, leafMessageId)
}

export function addSummaryMessage(
  aiChatId: string,
  content: string,
  meta: { bufferBoundaryTimestamp: number; compressedMessageCount: number }
) {
  return getManager().addSummaryMessage(aiChatId, content, meta)
}

export function getLatestSummary(aiChatId: string) {
  return getManager().getLatestSummary(aiChatId)
}

export function getMessagesAfterSummary(aiChatId: string, summaryTimestamp: number) {
  return getManager().getMessagesAfterSummary(aiChatId, summaryTimestamp)
}

export function getAllUserAssistantMessages(aiChatId: string) {
  return getManager().getAllUserAssistantMessages(aiChatId)
}

export function getMessageCountAfterSummary(aiChatId: string) {
  return getManager().getMessageCountAfterSummary(aiChatId)
}
