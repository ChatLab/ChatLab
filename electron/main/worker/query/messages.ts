/**
 * 聊天记录查询模块
 * 提供通用的消息查询功能：搜索、筛选、上下文、无限滚动等
 * 在 Worker 线程中执行
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../core'
import { ensureAvatarColumn } from './basic'

// ==================== 类型定义 ====================

/**
 * 消息查询结果类型
 */
export interface MessageResult {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
}

/**
 * 分页消息结果
 */
export interface PaginatedMessages {
  messages: MessageResult[]
  hasMore: boolean
}

/**
 * 带总数的消息结果
 */
export interface MessagesWithTotal {
  messages: MessageResult[]
  total: number
}

// ==================== 工具函数 ====================

/**
 * 数据库行类型（包含 aliases JSON 字符串和头像）
 */
interface DbMessageRow {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  aliases: string | null
  avatar: string | null
  content: string
  timestamp: number
  type: number
  reply_to_message_id: string | null
  replyToContent: string | null
  replyToSenderName: string | null
}

/**
 * 将数据库行转换为可序列化的 MessageResult
 * 处理 BigInt 等类型，确保 IPC 传输安全
 */
function sanitizeMessageRow(row: DbMessageRow): MessageResult {
  // 解析别名 JSON
  let aliases: string[] = []
  if (row.aliases) {
    try {
      aliases = JSON.parse(row.aliases)
    } catch {
      aliases = []
    }
  }

  return {
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    senderAliases: aliases,
    senderAvatar: row.avatar || null,
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
    replyToMessageId: row.reply_to_message_id || null,
    replyToContent: row.replyToContent || null,
    replyToSenderName: row.replyToSenderName || null,
  }
}

/**
 * 构建通用的发送者筛选条件
 */
function buildSenderCondition(senderId?: number): { condition: string; params: number[] } {
  if (senderId === undefined) {
    return { condition: '', params: [] }
  }
  return { condition: 'AND msg.sender_id = ?', params: [senderId] }
}

/**
 * 构建关键词筛选条件（OR 逻辑）
 */
function buildKeywordCondition(keywords?: string[]): { condition: string; params: string[] } {
  if (!keywords || keywords.length === 0) {
    return { condition: '', params: [] }
  }
  const condition = `AND (${keywords.map(() => `msg.content LIKE ?`).join(' OR ')})`
  const params = keywords.map((k) => `%${k}%`)
  return { condition, params }
}

// 排除系统消息的通用过滤条件
const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"

// 只获取文本消息的过滤条件
const TEXT_ONLY_FILTER = "AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content != ''"

// ==================== 查询函数 ====================

/**
 * 获取最近的消息（AI Agent 专用，只返回文本消息）
 * @param sessionId 会话 ID
 * @param filter 时间过滤器
 * @param limit 返回数量限制
 */
export function getRecentMessages(sessionId: string, filter?: TimeFilter, limit: number = 100): MessagesWithTotal {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }

  // 构建时间过滤条件（使用 'msg' 表别名避免多表 JOIN 时的列名歧义）
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 查询总数
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1
    ${timeCondition}
    ${SYSTEM_FILTER}
    ${TEXT_ONLY_FILTER}
  `
  const totalRow = db.prepare(countSql).get(...timeParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询最近消息（按时间降序）
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE 1=1
    ${timeCondition}
    ${SYSTEM_FILTER}
    ${TEXT_ONLY_FILTER}
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...timeParams, limit) as DbMessageRow[]

  // 返回时按时间正序排列（便于阅读）
  return {
    messages: rows.map(sanitizeMessageRow).reverse(),
    total,
  }
}

/**
 * 获取所有最近的消息（消息查看器专用，包含所有类型消息）
 * @param sessionId 会话 ID
 * @param filter 时间过滤器
 * @param limit 返回数量限制
 */
export function getAllRecentMessages(sessionId: string, filter?: TimeFilter, limit: number = 100): MessagesWithTotal {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }

  // 构建时间过滤条件（使用 'msg' 表别名避免多表 JOIN 时的列名歧义）
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 查询总数
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1
    ${timeCondition}
  `
  const totalRow = db.prepare(countSql).get(...timeParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询最近消息（按时间降序）
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE 1=1
    ${timeCondition}
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...timeParams, limit) as DbMessageRow[]

  // 返回时按时间正序排列（便于阅读）
  return {
    messages: rows.map(sanitizeMessageRow).reverse(),
    total,
  }
}

/**
 * 关键词搜索消息
 * @param sessionId 会话 ID
 * @param keywords 关键词数组（OR 逻辑），可以为空数组
 * @param filter 时间过滤器
 * @param limit 返回数量限制
 * @param offset 偏移量（分页）
 * @param senderId 可选的发送者成员 ID
 */
export function searchMessages(
  sessionId: string,
  keywords: string[],
  filter?: TimeFilter,
  limit: number = 20,
  offset: number = 0,
  senderId?: number
): MessagesWithTotal {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0 }

  // 构建关键词条件（OR 逻辑）
  let keywordCondition = '1=1' // 默认条件（始终为真）
  const keywordParams: string[] = []
  if (keywords.length > 0) {
    keywordCondition = `(${keywords.map(() => `msg.content LIKE ?`).join(' OR ')})`
    keywordParams.push(...keywords.map((k) => `%${k}%`))
  }

  // 构建时间过滤条件（使用 'msg' 表别名避免多表 JOIN 时的列名歧义）
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 构建发送者筛选条件
  const { condition: senderCondition, params: senderParams } = buildSenderCondition(senderId)

  // 查询总数
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE ${keywordCondition}
    ${timeCondition}
    ${senderCondition}
  `
  const totalRow = db.prepare(countSql).get(...keywordParams, ...timeParams, ...senderParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询消息
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE ${keywordCondition}
    ${timeCondition}
    ${senderCondition}
    ORDER BY msg.ts DESC
    LIMIT ? OFFSET ?
  `

  const rows = db.prepare(sql).all(...keywordParams, ...timeParams, ...senderParams, limit, offset) as DbMessageRow[]

  return {
    messages: rows.map(sanitizeMessageRow),
    total,
  }
}

/**
 * 获取消息上下文（指定消息前后的消息）
 * 使用消息 ID 方式获取精确的前后 N 条消息
 *
 * @param sessionId 会话 ID
 * @param messageIds 消息 ID 列表（支持单个或批量）
 * @param contextSize 上下文大小，前后各多少条消息，默认 20
 */
export function getMessageContext(
  sessionId: string,
  messageIds: number | number[],
  contextSize: number = 20
): MessageResult[] {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return []

  // 统一转为数组
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds]
  if (ids.length === 0) return []

  // 收集所有上下文消息的 ID（使用 Set 去重）
  const contextIds = new Set<number>()

  for (const messageId of ids) {
    // 添加目标消息本身
    contextIds.add(messageId)

    // 获取前 contextSize 条消息（id < messageId，按 id 降序取前 N 个）
    const beforeSql = `
      SELECT id FROM message
      WHERE id < ?
      ORDER BY id DESC
      LIMIT ?
    `
    const beforeRows = db.prepare(beforeSql).all(messageId, contextSize) as { id: number }[]
    beforeRows.forEach((row) => contextIds.add(row.id))

    // 获取后 contextSize 条消息（id > messageId，按 id 升序取前 N 个）
    const afterSql = `
      SELECT id FROM message
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?
    `
    const afterRows = db.prepare(afterSql).all(messageId, contextSize) as { id: number }[]
    afterRows.forEach((row) => contextIds.add(row.id))
  }

  // 如果没有找到任何消息
  if (contextIds.size === 0) return []

  // 批量查询所有上下文消息
  const idList = Array.from(contextIds)
  const placeholders = idList.map(() => '?').join(', ')

  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE msg.id IN (${placeholders})
    ORDER BY msg.id ASC
  `

  const rows = db.prepare(sql).all(...idList) as DbMessageRow[]

  return rows.map(sanitizeMessageRow)
}

/**
 * 获取指定消息之前的 N 条消息（用于向上无限滚动）
 * @param sessionId 会话 ID
 * @param beforeId 在此消息 ID 之前的消息
 * @param limit 返回数量限制
 * @param filter 可选的时间筛选条件
 * @param senderId 可选的发送者筛选
 * @param keywords 可选的关键词筛选
 */
export function getMessagesBefore(
  sessionId: string,
  beforeId: number,
  limit: number = 50,
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): PaginatedMessages {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return { messages: [], hasMore: false }

  // 构建时间过滤条件（使用 'msg' 表别名避免多表 JOIN 时的列名歧义）
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 构建关键词条件
  const { condition: keywordCondition, params: keywordParams } = buildKeywordCondition(keywords)

  // 构建发送者筛选条件
  const { condition: senderCondition, params: senderParams } = buildSenderCondition(senderId)

  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE msg.id < ?
    ${timeCondition}
    ${keywordCondition}
    ${senderCondition}
    ORDER BY msg.id DESC
    LIMIT ?
  `

  const rows = db
    .prepare(sql)
    .all(beforeId, ...timeParams, ...keywordParams, ...senderParams, limit + 1) as DbMessageRow[]

  const hasMore = rows.length > limit
  const resultRows = hasMore ? rows.slice(0, limit) : rows

  // 返回时按 ID 升序排列
  return {
    messages: resultRows.map(sanitizeMessageRow).reverse(),
    hasMore,
  }
}

/**
 * 获取指定消息之后的 N 条消息（用于向下无限滚动）
 * @param sessionId 会话 ID
 * @param afterId 在此消息 ID 之后的消息
 * @param limit 返回数量限制
 * @param filter 可选的时间筛选条件
 * @param senderId 可选的发送者筛选
 * @param keywords 可选的关键词筛选
 */
export function getMessagesAfter(
  sessionId: string,
  afterId: number,
  limit: number = 50,
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): PaginatedMessages {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return { messages: [], hasMore: false }

  // 构建时间过滤条件（使用 'msg' 表别名避免多表 JOIN 时的列名歧义）
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 构建关键词条件
  const { condition: keywordCondition, params: keywordParams } = buildKeywordCondition(keywords)

  // 构建发送者筛选条件
  const { condition: senderCondition, params: senderParams } = buildSenderCondition(senderId)

  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE msg.id > ?
    ${timeCondition}
    ${keywordCondition}
    ${senderCondition}
    ORDER BY msg.id ASC
    LIMIT ?
  `

  const rows = db
    .prepare(sql)
    .all(afterId, ...timeParams, ...keywordParams, ...senderParams, limit + 1) as DbMessageRow[]

  const hasMore = rows.length > limit
  const resultRows = hasMore ? rows.slice(0, limit) : rows

  return {
    messages: resultRows.map(sanitizeMessageRow),
    hasMore,
  }
}

/**
 * 获取两个成员之间的对话
 * 提取两人相邻发言形成的对话片段
 * @param sessionId 会话 ID
 * @param memberId1 成员1的 ID
 * @param memberId2 成员2的 ID
 * @param filter 时间过滤器
 * @param limit 返回消息数量限制
 */
export function getConversationBetween(
  sessionId: string,
  memberId1: number,
  memberId2: number,
  filter?: TimeFilter,
  limit: number = 100
): MessagesWithTotal & { member1Name: string; member2Name: string } {
  // 确保数据库有 avatar 字段（兼容旧数据库）
  ensureAvatarColumn(sessionId)

  const db = openDatabase(sessionId)
  if (!db) return { messages: [], total: 0, member1Name: '', member2Name: '' }

  // 获取成员名称
  const member1 = db
    .prepare(
      `
    SELECT COALESCE(group_nickname, account_name, platform_id) as name
    FROM member WHERE id = ?
  `
    )
    .get(memberId1) as { name: string } | undefined

  const member2 = db
    .prepare(
      `
    SELECT COALESCE(group_nickname, account_name, platform_id) as name
    FROM member WHERE id = ?
  `
    )
    .get(memberId2) as { name: string } | undefined

  if (!member1 || !member2) {
    return { messages: [], total: 0, member1Name: '', member2Name: '' }
  }

  // 构建时间过滤条件（使用 'msg' 表别名避免多表 JOIN 时的列名歧义）
  const { clause: timeClause, params: timeParams } = buildTimeFilter(filter, 'msg')
  const timeCondition = timeClause ? timeClause.replace('WHERE', 'AND') : ''

  // 查询两人之间的所有消息
  const countSql = `
    SELECT COUNT(*) as total
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.sender_id IN (?, ?)
    ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
  `
  const totalRow = db.prepare(countSql).get(memberId1, memberId2, ...timeParams) as { total: number }
  const total = totalRow?.total || 0

  // 查询消息
  const sql = `
    SELECT
      msg.id,
      m.id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
      m.platform_id as senderPlatformId,
      m.aliases,
      m.avatar,
      msg.content,
      msg.ts as timestamp,
      msg.type,
      msg.reply_to_message_id,
      reply_msg.content as replyToContent,
      COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
    LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
    WHERE msg.sender_id IN (?, ?)
    ${timeCondition}
    AND msg.content IS NOT NULL AND msg.content != ''
    ORDER BY msg.ts DESC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(memberId1, memberId2, ...timeParams, limit) as DbMessageRow[]

  // 返回时按时间正序排列（便于阅读对话）
  return {
    messages: rows.map(sanitizeMessageRow).reverse(),
    total,
    member1Name: member1.name,
    member2Name: member2.name,
  }
}
