/**
 * FetchMessageAdapter — Web (CLI serve) message query implementation
 *
 * Delegates to shared async query functions from @openchatlab/core,
 * using a pluginQuery-based AsyncSqlExecutor.
 */

import type { AsyncSqlExecutor } from '@openchatlab/core'
import {
  fetchMessagesBefore,
  fetchMessagesAfter,
  fetchMessageContext,
  searchMessagesLikeAsync,
  fetchAllRecentMessages,
} from '@openchatlab/core'
import type {
  MessageAdapter,
  TimeFilter,
  PaginatedMessages,
  MessageRecord,
  SearchResult,
  MessageMarkFilter,
} from './types'
import { getRegisteredAdapter } from '../registry'
import type { DataAdapter } from '../data/types'

function getDataAdapter(): DataAdapter {
  return getRegisteredAdapter<DataAdapter>('data')
}

function createPluginQueryExecutor(sessionId: string): AsyncSqlExecutor {
  const adapter = getDataAdapter()
  return {
    all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return adapter.pluginQuery<T>(sessionId, sql, params)
    },
    async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const rows = await adapter.pluginQuery<T>(sessionId, sql, params)
      return rows[0]
    },
  }
}

export class FetchMessageAdapter implements MessageAdapter {
  async getMessagesBefore(
    sessionId: string,
    beforeId: number,
    limit: number = 50,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ): Promise<PaginatedMessages> {
    const executor = createPluginQueryExecutor(sessionId)
    return fetchMessagesBefore(executor, beforeId, limit, filter, senderId, keywords)
  }

  async getMessagesAfter(
    sessionId: string,
    afterId: number,
    limit: number = 50,
    filter?: TimeFilter,
    senderId?: number,
    keywords?: string[]
  ): Promise<PaginatedMessages> {
    const executor = createPluginQueryExecutor(sessionId)
    return fetchMessagesAfter(executor, afterId, limit, filter, senderId, keywords)
  }

  async getMessageContext(
    sessionId: string,
    messageIds: number | number[],
    contextSize: number = 20
  ): Promise<MessageRecord[]> {
    const executor = createPluginQueryExecutor(sessionId)
    return fetchMessageContext(executor, messageIds, contextSize)
  }

  async searchMessages(
    sessionId: string,
    keywords: string[],
    filter?: TimeFilter,
    limit: number = 100,
    offset: number = 0,
    senderId?: number,
    markFilter?: MessageMarkFilter
  ): Promise<SearchResult> {
    const executor = createPluginQueryExecutor(sessionId)
    return searchMessagesLikeAsync(executor, keywords, filter, limit, offset, senderId, markFilter)
  }

  async getAllRecentMessages(sessionId: string, filter?: TimeFilter, limit: number = 100): Promise<SearchResult> {
    const executor = createPluginQueryExecutor(sessionId)
    return fetchAllRecentMessages(executor, filter, limit)
  }
}
