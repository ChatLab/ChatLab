/**
 * 自定义筛选模块
 * 提供按条件筛选消息和获取多会话消息等功能
 */

import { openReadonlyDatabase } from './core'
import type { FilterMessage, ContextBlock, FilterResultWithPagination } from './types'

/**
 * 按条件筛选消息并扩充上下文（支持分页）
 *
 * 两阶段查询架构：
 * 1. 第一阶段：轻量级查询获取消息 ID、序号和匹配信息（不加载完整内容）
 * 2. 第二阶段：计算上下文范围、合并、分页后只获取当前页的完整消息
 *
 * @param sessionId 数据库会话ID
 * @param keywords 关键词列表（可选，OR 逻辑）
 * @param timeFilter 时间过滤器（可选）
 * @param senderIds 发送者ID列表（可选）
 * @param contextSize 上下文扩展数量（前后各多少条）
 * @param page 页码（从 1 开始，默认 1）
 * @param pageSize 每页块数（默认 50）
 * @returns 筛选结果（带分页信息）
 */
export function filterMessagesWithContext(
  sessionId: string,
  keywords?: string[],
  timeFilter?: { startTs: number; endTs: number },
  senderIds?: number[],
  contextSize: number = 10,
  page: number = 1,
  pageSize: number = 50
): FilterResultWithPagination {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
    }
  }

  try {
    // ==================== 第一阶段：轻量级查询 ====================
    // 只获取消息的 ID、时间戳、发送者ID、内容（用于匹配）
    // 使用 ROW_NUMBER() 计算全局序号，避免一次性加载所有完整数据

    const lightweightSql = `
      SELECT
        id,
        ts,
        sender_id as senderId,
        content
      FROM message
      ${timeFilter ? 'WHERE ts >= ? AND ts <= ?' : ''}
      ORDER BY ts ASC, id ASC
    `

    const params: unknown[] = []
    if (timeFilter) {
      params.push(timeFilter.startTs, timeFilter.endTs)
    }

    // 使用 iterate() 流式处理，避免一次性加载所有数据到内存
    const stmt = db.prepare(lightweightSql)
    const hitIndexes: number[] = []
    let totalMessageCount = 0
    let estimatedTotalChars = 0

    // 流式遍历消息，标记命中的索引
    for (const row of stmt.iterate(...params) as Iterable<{
      id: number
      ts: number
      senderId: number
      content: string | null
    }>) {
      let isHit = true

      // 关键词匹配（OR 逻辑）
      if (keywords && keywords.length > 0) {
        const content = (row.content || '').toLowerCase()
        isHit = keywords.some((kw) => content.includes(kw.toLowerCase()))
      }

      // 发送者匹配
      if (isHit && senderIds && senderIds.length > 0) {
        isHit = senderIds.includes(row.senderId)
      }

      if (isHit) {
        hitIndexes.push(totalMessageCount)
      }

      totalMessageCount++
    }

    if (hitIndexes.length === 0) {
      return {
        blocks: [],
        stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
        pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
      }
    }

    // ==================== 计算上下文范围并合并 ====================
    const ranges: Array<{ start: number; end: number; hitIndexes: number[] }> = []

    for (const hitIndex of hitIndexes) {
      const start = Math.max(0, hitIndex - contextSize)
      const end = Math.min(totalMessageCount - 1, hitIndex + contextSize)

      // 检查是否能与前一个范围合并
      if (ranges.length > 0) {
        const lastRange = ranges[ranges.length - 1]
        if (start <= lastRange.end + 1) {
          lastRange.end = Math.max(lastRange.end, end)
          lastRange.hitIndexes.push(hitIndex)
          continue
        }
      }

      ranges.push({ start, end, hitIndexes: [hitIndex] })
    }

    const totalBlocks = ranges.length
    const totalHits = hitIndexes.length

    // ==================== 分页处理 ====================
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalBlocks)
    const pageRanges = ranges.slice(startIndex, endIndex)
    const hasMore = endIndex < totalBlocks

    if (pageRanges.length === 0) {
      return {
        blocks: [],
        stats: { totalMessages: 0, hitMessages: totalHits, totalChars: 0 },
        pagination: { page, pageSize, totalBlocks, totalHits, hasMore: false },
      }
    }

    // ==================== 第二阶段：获取当前页的完整消息 ====================
    // 只为当前页的范围获取完整消息数据

    const blocks: ContextBlock[] = []
    let totalMessages = 0
    let totalChars = 0

    for (const range of pageRanges) {
      // 使用 LIMIT OFFSET 获取指定范围的消息
      const blockSql = `
        SELECT
          msg.id,
          msg.ts,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
          m.platform_id as senderPlatformId,
          COALESCE(m.aliases, '[]') as senderAliasesJson,
          m.avatar as senderAvatar,
          msg.content,
          msg.type,
          msg.reply_to_message_id as replyToMessageId,
          reply_msg.content as replyToContent,
          COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
        LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
        ${timeFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''}
        ORDER BY msg.ts ASC, msg.id ASC
        LIMIT ? OFFSET ?
      `

      const blockParams: unknown[] = []
      if (timeFilter) {
        blockParams.push(timeFilter.startTs, timeFilter.endTs)
      }
      blockParams.push(range.end - range.start + 1, range.start)

      const messages = db.prepare(blockSql).all(...blockParams) as Array<{
        id: number
        ts: number
        senderName: string
        senderPlatformId: string
        senderAliasesJson: string
        senderAvatar: string | null
        content: string | null
        type: number
        replyToMessageId: string | null
        replyToContent: string | null
        replyToSenderName: string | null
      }>

      // 构建 hitIndexSet（相对于 range.start 的偏移）
      const hitIndexSet = new Set(range.hitIndexes.map((idx) => idx - range.start))

      const blockMessages: FilterMessage[] = []
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        const isHit = hitIndexSet.has(i)

        // 解析别名 JSON
        let senderAliases: string[] = []
        try {
          senderAliases = JSON.parse(msg.senderAliasesJson || '[]')
        } catch {
          senderAliases = []
        }

        blockMessages.push({
          id: msg.id,
          senderName: msg.senderName,
          senderPlatformId: msg.senderPlatformId,
          senderAliases,
          senderAvatar: msg.senderAvatar,
          content: msg.content || '',
          timestamp: msg.ts,
          type: msg.type,
          replyToMessageId: msg.replyToMessageId,
          replyToContent: msg.replyToContent,
          replyToSenderName: msg.replyToSenderName,
          isHit,
        })
        totalChars += (msg.content || '').length
      }

      if (blockMessages.length > 0) {
        blocks.push({
          startTs: blockMessages[0].timestamp,
          endTs: blockMessages[blockMessages.length - 1].timestamp,
          messages: blockMessages,
          hitCount: range.hitIndexes.length,
        })
        totalMessages += blockMessages.length
      }
    }

    // 如果是第一页，需要估算总字符数（用于统计显示）
    // 由于我们不再一次性加载所有数据，这里使用采样估算
    if (page === 1 && totalBlocks > pageSize) {
      // 估算：当前页的平均字符数 × 总块数
      const avgCharsPerBlock = totalChars / blocks.length
      estimatedTotalChars = Math.round(avgCharsPerBlock * totalBlocks)
    } else if (page === 1) {
      estimatedTotalChars = totalChars
    }

    return {
      blocks,
      stats: {
        totalMessages: page === 1 ? totalMessages : 0, // 只有第一页返回准确的消息数
        hitMessages: totalHits,
        totalChars: page === 1 ? (totalBlocks > pageSize ? estimatedTotalChars : totalChars) : 0,
      },
      pagination: {
        page,
        pageSize,
        totalBlocks,
        totalHits,
        hasMore,
      },
    }
  } catch (error) {
    console.error('filterMessagesWithContext error:', error)
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
    }
  } finally {
    db.close()
  }
}

/**
 * 获取多个会话的完整消息（用于会话筛选模式，支持分页）
 *
 * @param sessionId 数据库会话ID
 * @param chatSessionIds 要获取的会话ID列表
 * @param page 页码（从 1 开始，默认 1）
 * @param pageSize 每页块数（默认 50）
 * @returns 合并后的上下文块和统计（带分页信息）
 */
export function getMultipleSessionsMessages(
  sessionId: string,
  chatSessionIds: number[],
  page: number = 1,
  pageSize: number = 50
): FilterResultWithPagination {
  const db = openReadonlyDatabase(sessionId)
  if (!db) {
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
    }
  }

  try {
    if (chatSessionIds.length === 0) {
      return {
        blocks: [],
        stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
        pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
      }
    }

    // 先获取会话信息，按时间排序
    const sessionsSql = `
      SELECT id, start_ts as startTs, end_ts as endTs, message_count as messageCount
      FROM chat_session
      WHERE id IN (${chatSessionIds.map(() => '?').join(',')})
      ORDER BY start_ts ASC
    `
    const allSessions = db.prepare(sessionsSql).all(...chatSessionIds) as Array<{
      id: number
      startTs: number
      endTs: number
      messageCount: number
    }>

    const totalBlocks = allSessions.length

    // 分页处理
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, totalBlocks)
    const pageSessions = allSessions.slice(startIndex, endIndex)
    const hasMore = endIndex < totalBlocks

    if (pageSessions.length === 0) {
      return {
        blocks: [],
        stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
        pagination: { page, pageSize, totalBlocks, totalHits: 0, hasMore: false },
      }
    }

    const blocks: ContextBlock[] = []
    let totalMessages = 0
    let totalChars = 0

    // 为当前页的会话获取消息（完整信息）
    const messagesSql = `
      SELECT
        msg.id,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
        m.platform_id as senderPlatformId,
        COALESCE(m.aliases, '[]') as senderAliasesJson,
        m.avatar as senderAvatar,
        msg.content,
        msg.type,
        msg.reply_to_message_id as replyToMessageId,
        reply_msg.content as replyToContent,
        COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName,
        msg.ts as timestamp
      FROM message_context mc
      JOIN message msg ON msg.id = mc.message_id
      JOIN member m ON msg.sender_id = m.id
      LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
      LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
      WHERE mc.session_id = ?
      ORDER BY msg.ts ASC
    `

    for (const session of pageSessions) {
      const messages = db.prepare(messagesSql).all(session.id) as Array<{
        id: number
        senderName: string
        senderPlatformId: string
        senderAliasesJson: string
        senderAvatar: string | null
        content: string | null
        type: number
        replyToMessageId: string | null
        replyToContent: string | null
        replyToSenderName: string | null
        timestamp: number
      }>

      const blockMessages: FilterMessage[] = messages.map((msg) => {
        // 解析别名 JSON
        let senderAliases: string[] = []
        try {
          senderAliases = JSON.parse(msg.senderAliasesJson || '[]')
        } catch {
          senderAliases = []
        }

        return {
          id: msg.id,
          senderName: msg.senderName,
          senderPlatformId: msg.senderPlatformId,
          senderAliases,
          senderAvatar: msg.senderAvatar,
          content: msg.content || '',
          timestamp: msg.timestamp,
          type: msg.type,
          replyToMessageId: msg.replyToMessageId,
          replyToContent: msg.replyToContent,
          replyToSenderName: msg.replyToSenderName,
          isHit: false, // 会话模式下没有命中高亮
        }
      })

      for (const msg of messages) {
        totalChars += (msg.content || '').length
      }

      blocks.push({
        startTs: session.startTs,
        endTs: session.endTs,
        messages: blockMessages,
        hitCount: 0,
      })

      totalMessages += messages.length
    }

    return {
      blocks,
      stats: {
        totalMessages: page === 1 ? totalMessages : 0, // 只有第一页返回准确的消息数
        hitMessages: 0, // 会话模式没有命中概念
        totalChars: page === 1 ? totalChars : 0,
      },
      pagination: {
        page,
        pageSize,
        totalBlocks,
        totalHits: 0,
        hasMore,
      },
    }
  } catch (error) {
    console.error('getMultipleSessionsMessages error:', error)
    return {
      blocks: [],
      stats: { totalMessages: 0, hitMessages: 0, totalChars: 0 },
      pagination: { page, pageSize, totalBlocks: 0, totalHits: 0, hasMore: false },
    }
  } finally {
    db.close()
  }
}
