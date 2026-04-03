/**
 * AI 工具专用查询模块
 * 提供搜索会话和获取会话消息等功能，供 AI 工具使用
 */

import { openReadonlyDatabase } from './core'
import type { SessionSearchResultItem, SessionMessagesResult } from './types'
import { hasFtsIndex } from '../fts'
import { tokenizeQueryForFts } from '../../../nlp/ftsTokenizer'

/**
 * 搜索会话（用于 AI 工具）
 * 支持按关键词和时间范围筛选会话
 *
 * @param sessionId 数据库会话ID
 * @param keywords 关键词列表（可选，或逻辑匹配）
 * @param timeFilter 时间过滤器（可选）
 * @param limit 返回数量限制，默认 20
 * @param previewCount 预览消息数量，默认 5
 * @returns 匹配的会话列表
 */
export function searchSessions(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  limit: number = 20,
  previewCount: number = 5
): SessionSearchResultItem[] {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return []
  }

  try {
    // 1. 构建会话查询 SQL
    let sessionSql = `
      SELECT
        cs.id,
        cs.start_ts as startTs,
        cs.end_ts as endTs,
        cs.message_count as messageCount
      FROM chat_session cs
      WHERE 1=1
    `
    const params: unknown[] = []

    // 时间范围过滤
    if (timeFilter) {
      sessionSql += ` AND cs.start_ts >= ? AND cs.end_ts <= ?`
      params.push(timeFilter.startTs, timeFilter.endTs)
    }

    // 关键词过滤：只返回包含关键词的会话
    if (keywords && keywords.length > 0) {
      const useFts = hasFtsIndex(sessionId)
      const matchQuery = useFts ? tokenizeQueryForFts(keywords) : ''

      if (useFts && matchQuery) {
        sessionSql += `
          AND cs.id IN (
            SELECT DISTINCT mc.session_id
            FROM message_context mc
            WHERE mc.message_id IN (SELECT rowid FROM message_fts WHERE content MATCH ?)
          )
        `
        params.push(matchQuery)
      } else {
        const keywordConditions = keywords.map(() => `m.content LIKE ?`).join(' OR ')
        sessionSql += `
          AND cs.id IN (
            SELECT DISTINCT mc.session_id
            FROM message_context mc
            JOIN message m ON m.id = mc.message_id
            WHERE (${keywordConditions})
          )
        `
        for (const kw of keywords) {
          params.push(`%${kw}%`)
        }
      }
    }

    sessionSql += ` ORDER BY cs.start_ts DESC LIMIT ?`
    params.push(limit)

    const sessions = db.prepare(sessionSql).all(...params) as Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
    }>

    // 2. 为每个会话获取预览消息
    const previewSql = `
      SELECT
        m.id,
        mb.id as senderId,
        COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
        mb.platform_id as senderPlatformId,
        m.content,
        m.ts as timestamp
      FROM message_context mc
      JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id
      WHERE mc.session_id = ?
      ORDER BY m.ts ASC
      LIMIT ?
    `

    const results: SessionSearchResultItem[] = []
    for (const session of sessions) {
      const previewMessages = db.prepare(previewSql).all(session.id, previewCount) as Array<{
        id: number
        senderId: number
        senderName: string
        senderPlatformId: string
        content: string | null
        timestamp: number
      }>

      results.push({
        id: session.id,
        startTs: session.startTs,
        endTs: session.endTs,
        messageCount: session.messageCount,
        isComplete: session.messageCount <= previewCount,
        previewMessages,
      })
    }

    return results
  } catch (error) {
    console.error('searchSessions error:', error)
    return []
  } finally {
    db.close()
  }
}

/**
 * 获取会话的完整消息（用于 AI 工具）
 *
 * @param sessionId 数据库会话ID
 * @param chatSessionId 会话索引中的会话ID
 * @param limit 返回数量限制，默认 500
 * @returns 会话的完整消息
 */
export function getSessionMessages(
  sessionId: string,
  chatSessionId: number,
  limit: number = 500
): SessionMessagesResult | null {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return null
  }

  try {
    // 1. 获取会话基本信息
    const sessionSql = `
      SELECT
        id,
        start_ts as startTs,
        end_ts as endTs,
        message_count as messageCount
      FROM chat_session
      WHERE id = ?
    `
    const session = db.prepare(sessionSql).get(chatSessionId) as
      | {
          id: number
          startTs: number
          endTs: number
          messageCount: number
        }
      | undefined

    if (!session) {
      db.close()
      return null
    }

    // 2. 获取会话消息
    const messagesSql = `
      SELECT
        m.id,
        mb.id as senderId,
        COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
        mb.platform_id as senderPlatformId,
        m.content,
        m.ts as timestamp
      FROM message_context mc
      JOIN message m ON m.id = mc.message_id
      JOIN member mb ON mb.id = m.sender_id
      WHERE mc.session_id = ?
      ORDER BY m.ts ASC
      LIMIT ?
    `
    const messages = db.prepare(messagesSql).all(chatSessionId, limit) as Array<{
      id: number
      senderId: number
      senderName: string
      senderPlatformId: string
      content: string | null
      timestamp: number
    }>

    // 3. 统计参与者
    const participantsSet = new Set<string>()
    for (const msg of messages) {
      participantsSet.add(msg.senderName)
    }

    return {
      sessionId: session.id,
      startTs: session.startTs,
      endTs: session.endTs,
      messageCount: session.messageCount,
      returnedCount: messages.length,
      participants: Array.from(participantsSet),
      messages,
    }
  } catch (error) {
    console.error('getSessionMessages error:', error)
    return null
  } finally {
    db.close()
  }
}
