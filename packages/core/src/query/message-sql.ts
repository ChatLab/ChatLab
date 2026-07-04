/**
 * Shared full-message SQL template, types, and row mapper.
 *
 * Single source of truth for all platforms (Electron worker, CLI Web FetchMessageAdapter).
 * Each platform imports these constants and the mapper; only the SQL execution
 * mechanism differs (direct db.prepare vs pluginQuery HTTP).
 */

// ==================== SQL fragments ====================

export const FULL_MSG_COLUMNS = `
  msg.id,
  m.id as senderId,
  COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
  m.platform_id as senderPlatformId,
  COALESCE(m.aliases, '[]') as aliasesJson,
  m.avatar as senderAvatar,
  msg.content,
  msg.ts as timestamp,
  msg.type,
  msg.reply_to_message_id as replyToMessageId,
  reply_msg.content as replyToContent,
  COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName`

export const FULL_MSG_FROM = `
  FROM message msg
  JOIN member m ON msg.sender_id = m.id
  LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
  LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id`

export const FULL_MSG_SELECT = `SELECT ${FULL_MSG_COLUMNS} ${FULL_MSG_FROM}`

export const MSG_COUNT_FROM = `FROM message msg JOIN member m ON msg.sender_id = m.id`

export const SYSTEM_MSG_FILTER = "COALESCE(m.account_name, '') != '系统消息'"
export const TEXT_ONLY_FILTER = "msg.type = 0 AND msg.content IS NOT NULL AND msg.content != ''"

// ==================== Types ====================

export interface FullMessageRow {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  aliasesJson: string
  senderAvatar: string | null
  content: string | null
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
}

export interface MappedMessage {
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

// ==================== Row mapper ====================

export function mapMessageRow(row: FullMessageRow): MappedMessage {
  let senderAliases: string[] = []
  try {
    const parsed = JSON.parse(row.aliasesJson || '[]')
    if (Array.isArray(parsed)) senderAliases = parsed
  } catch {
    /* ignore malformed JSON */
  }

  return {
    id: Number(row.id),
    senderId: Number(row.senderId),
    senderName: String(row.senderName || ''),
    senderPlatformId: String(row.senderPlatformId || ''),
    senderAliases,
    senderAvatar: row.senderAvatar || null,
    content: row.content != null ? String(row.content) : '',
    timestamp: Number(row.timestamp),
    type: Number(row.type),
    replyToMessageId: row.replyToMessageId || null,
    replyToContent: row.replyToContent || null,
    replyToSenderName: row.replyToSenderName || null,
  }
}

// ==================== Query builders ====================

export interface MsgQueryConditions {
  clause: string
  params: unknown[]
}

/** Escape LIKE wildcards (%, _, \) so user keywords match literally with ESCAPE '\'. */
export function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * Build blacklist exclusion conditions (parameterized NOT LIKE ... ESCAPE, ASCII
 * case-insensitive, wildcards escaped). NULL content is kept, matching the
 * preprocessing pipeline's blacklist behavior. Returns bare conditions without
 * an AND prefix so callers can embed them in any WHERE clause.
 */
export function buildExcludeKeywordsConditions(
  excludeKeywords: string[],
  column = 'msg.content'
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  for (const keyword of excludeKeywords) {
    conditions.push(`(${column} IS NULL OR lower(${column}) NOT LIKE ? ESCAPE '\\')`)
    params.push(`%${escapeLikePattern(keyword.toLowerCase())}%`)
  }
  return { conditions, params }
}

export function buildMsgConditions(options?: {
  startTs?: number
  endTs?: number
  senderId?: number
  memberId?: number | null
  keywords?: string[]
  /** Keyword join mode: 'any' (OR, default) or 'all' (AND). */
  matchMode?: 'any' | 'all'
  /**
   * Blacklist pushdown: rows whose content contains any keyword are excluded
   * (case-insensitive for ASCII, wildcards escaped). NULL content is kept,
   * matching the preprocessing pipeline's blacklist behavior.
   */
  excludeKeywords?: string[]
  systemFilter?: boolean
  textOnlyFilter?: boolean
}): MsgQueryConditions {
  const conds: string[] = []
  const params: unknown[] = []

  if (options?.startTs != null) {
    conds.push('msg.ts >= ?')
    params.push(options.startTs)
  }
  if (options?.endTs != null) {
    conds.push('msg.ts <= ?')
    params.push(options.endTs)
  }
  if (options?.senderId != null) {
    conds.push('msg.sender_id = ?')
    params.push(options.senderId)
  }
  if (options?.memberId != null) {
    conds.push('msg.sender_id = ?')
    params.push(options.memberId)
  }
  if (options?.keywords && options.keywords.length > 0) {
    const joiner = options.matchMode === 'all' ? ' AND ' : ' OR '
    const kwConds = options.keywords.map(() => "msg.content LIKE ? ESCAPE '\\'")
    conds.push(`(${kwConds.join(joiner)})`)
    params.push(...options.keywords.map((k) => `%${escapeLikePattern(k)}%`))
  }
  if (options?.excludeKeywords && options.excludeKeywords.length > 0) {
    const exclude = buildExcludeKeywordsConditions(options.excludeKeywords)
    conds.push(...exclude.conditions)
    params.push(...exclude.params)
  }
  if (options?.systemFilter) {
    conds.push(SYSTEM_MSG_FILTER)
  }
  if (options?.textOnlyFilter) {
    conds.push(TEXT_ONLY_FILTER)
  }

  return {
    clause: conds.length > 0 ? 'AND ' + conds.join(' AND ') : '',
    params,
  }
}
