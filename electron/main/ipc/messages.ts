/**
 * 聊天记录查询 IPC 处理器
 * 提供通用的消息查询功能：搜索、筛选、上下文、无限滚动等
 */

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import * as worker from '../worker/workerManager'

export function registerMessagesHandlers({ win }: IpcContext): void {
  console.log('[IPC] Registering Messages handlers...')

  /**
   * 关键词搜索消息
   */
  ipcMain.handle(
    'ai:searchMessages',
    async (
      _,
      sessionId: string,
      keywords: string[],
      filter?: { startTs?: number; endTs?: number },
      limit?: number,
      offset?: number,
      senderId?: number
    ) => {
      try {
        return await worker.searchMessages(sessionId, keywords, filter, limit, offset, senderId)
      } catch (error) {
        console.error('Failed to search messages:', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取消息上下文
   */
  ipcMain.handle(
    'ai:getMessageContext',
    async (_, sessionId: string, messageIds: number | number[], contextSize?: number) => {
      try {
        return await worker.getMessageContext(sessionId, messageIds, contextSize)
      } catch (error) {
        console.error('Failed to get message context:', error)
        return []
      }
    }
  )

  /**
   * 获取最近消息（AI Agent 专用）
   */
  ipcMain.handle(
    'ai:getRecentMessages',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, limit?: number) => {
      try {
        return await worker.getRecentMessages(sessionId, filter, limit)
      } catch (error) {
        console.error('Failed to get recent messages:', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取所有最近消息（消息查看器专用）
   */
  ipcMain.handle(
    'ai:getAllRecentMessages',
    async (_, sessionId: string, filter?: { startTs?: number; endTs?: number }, limit?: number) => {
      try {
        return await worker.getAllRecentMessages(sessionId, filter, limit)
      } catch (error) {
        console.error('Failed to get all recent messages:', error)
        return { messages: [], total: 0 }
      }
    }
  )

  /**
   * 获取两人之间的对话
   */
  ipcMain.handle(
    'ai:getConversationBetween',
    async (
      _,
      sessionId: string,
      memberId1: number,
      memberId2: number,
      filter?: { startTs?: number; endTs?: number },
      limit?: number
    ) => {
      try {
        return await worker.getConversationBetween(sessionId, memberId1, memberId2, filter, limit)
      } catch (error) {
        console.error('Failed to get conversation:', error)
        return { messages: [], total: 0, member1Name: '', member2Name: '' }
      }
    }
  )

  /**
   * 获取指定消息之前的 N 条（用于向上无限滚动）
   */
  ipcMain.handle(
    'ai:getMessagesBefore',
    async (
      _,
      sessionId: string,
      beforeId: number,
      limit?: number,
      filter?: { startTs?: number; endTs?: number },
      senderId?: number,
      keywords?: string[]
    ) => {
      try {
        return await worker.getMessagesBefore(sessionId, beforeId, limit, filter, senderId, keywords)
      } catch (error) {
        console.error('Failed to get previous messages:', error)
        return { messages: [], hasMore: false }
      }
    }
  )

  /**
   * 获取指定消息之后的 N 条（用于向下无限滚动）
   */
  ipcMain.handle(
    'ai:getMessagesAfter',
    async (
      _,
      sessionId: string,
      afterId: number,
      limit?: number,
      filter?: { startTs?: number; endTs?: number },
      senderId?: number,
      keywords?: string[]
    ) => {
      try {
        return await worker.getMessagesAfter(sessionId, afterId, limit, filter, senderId, keywords)
      } catch (error) {
        console.error('Failed to get next messages:', error)
        return { messages: [], hasMore: false }
      }
    }
  )

  // ==================== 自定义筛选 ====================

  /**
   * 按条件筛选消息并扩充上下文（支持分页）
   */
  ipcMain.handle(
    'ai:filterMessagesWithContext',
    async (
      _,
      sessionId: string,
      keywords?: string[],
      timeFilter?: { startTs: number; endTs: number },
      senderIds?: number[],
      contextSize?: number,
      page?: number,
      pageSize?: number
    ) => {
      try {
        return await worker.filterMessagesWithContext(
          sessionId,
          keywords,
          timeFilter,
          senderIds,
          contextSize,
          page,
          pageSize
        )
      } catch (error) {
        console.error('Failed to filter messages:', error)
        return {
          blocks: [],
          stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
          pagination: { page: page ?? 1, pageSize: pageSize ?? 50, totalBlocks: 0, totalHits: 0, hasMore: false },
        }
      }
    }
  )

  /**
   * 获取多个会话的完整消息（支持分页）
   */
  ipcMain.handle(
    'ai:getMultipleSessionsMessages',
    async (_, sessionId: string, chatSessionIds: number[], page?: number, pageSize?: number) => {
      try {
        return await worker.getMultipleSessionsMessages(sessionId, chatSessionIds, page, pageSize)
      } catch (error) {
        console.error('Failed to get multi-session messages:', error)
        return {
          blocks: [],
          stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
          pagination: { page: page ?? 1, pageSize: pageSize ?? 50, totalBlocks: 0, totalHits: 0, hasMore: false },
        }
      }
    }
  )

  /**
   * 导出筛选结果到文件（后端生成，支持进度）
   */
  ipcMain.handle(
    'ai:exportFilterResultToFile',
    async (
      _,
      params: {
        sessionId: string
        sessionName: string
        outputDir: string
        filterMode: 'condition' | 'session'
        keywords?: string[]
        timeFilter?: { startTs: number; endTs: number }
        senderIds?: number[]
        contextSize?: number
        chatSessionIds?: number[]
      }
    ) => {
      try {
        return await worker.exportFilterResultToFile(params, (progress) => {
          // 发送进度到渲染进程
          win.webContents.send('ai:exportProgress', progress)
        })
      } catch (error) {
        console.error('Failed to export filtered results:', error)
        return { success: false, error: String(error) }
      }
    }
  )
}
