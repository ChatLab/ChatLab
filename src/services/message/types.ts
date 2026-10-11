/**
 * MessageAdapter — 聊天记录消息查询领域适配器接口
 *
 * 负责聊天记录的分页查询、搜索、上下文获取等。
 * 来源：window.aiApi 的消息查询方法 / web-api-shim 垫片中的 SQL 查询
 */

import type { MappedMessage } from '@openchatlab/core'

export interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number
}

export type MessageRecord = MappedMessage

export interface PaginatedMessages {
  messages: MessageRecord[]
  hasMore: boolean
  total?: number
}

export interface SearchResult {
  messages: MessageRecord[]
  total: number
}

export interface MessageMarkFilter {
  categories?: string[]
  color?: string
  comments?: string[]
}

export interface MessageAdapter {
  getMessagesBefore(
    sessionId: string,
    beforeId: number,
    limit: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ): Promise<PaginatedMessages>

  getMessagesAfter(
    sessionId: string,
    afterId: number,
    limit: number,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ): Promise<PaginatedMessages>

  getMessageContext(sessionId: string, messageIds: number | number[], contextSize?: number): Promise<MessageRecord[]>

  searchMessages(
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit?: number,
    offset?: number,
    senderId?: number,
    markFilter?: MessageMarkFilter
  ): Promise<SearchResult>

  getAllRecentMessages(sessionId: string, filter?: TimeFilter, limit?: number): Promise<SearchResult>
}
