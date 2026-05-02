/**
 * AI 对话历史管理模块
 * 在主进程中执行，管理 AI 对话的持久化存储
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import { getAiDataDir, ensureDir } from '../paths'
import { aiLogger } from './logger'

const DEFAULT_GENERAL_ID = 'general_cn'

// AI 数据库实例
let AI_DB: Database.Database | null = null

// DEBUG 模式：暂存待写入的 debug context（key = conversationId）
const pendingDebugContextMap = new Map<string, string>()

/**
 * 获取 AI 数据库目录
 */
function getAiDbDir(): string {
  return getAiDataDir()
}

/**
 * 确保 AI 数据库目录存在
 */
function ensureAiDbDir(): void {
  ensureDir(getAiDbDir())
}

/**
 * 获取 AI 数据库实例（单例）
 */
function getAiDb(): Database.Database {
  if (AI_DB) return AI_DB

  ensureAiDbDir()
  const dbPath = path.join(getAiDbDir(), 'conversations.db')
  AI_DB = new Database(dbPath)
  AI_DB.pragma('journal_mode = WAL')

  // 创建表结构
  AI_DB.exec(`
    -- AI 对话表
    CREATE TABLE IF NOT EXISTS ai_conversation (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- AI 消息表
    CREATE TABLE IF NOT EXISTS ai_message (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data_keywords TEXT,
      data_message_count INTEGER,
      content_blocks TEXT,
      FOREIGN KEY(conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_ai_conversation_session ON ai_conversation(session_id);
    CREATE INDEX IF NOT EXISTS idx_ai_message_conversation ON ai_message(conversation_id);
  `)

  // 数据库迁移：为旧数据库添加缺失的列
  migrateAiDatabase(AI_DB)

  return AI_DB
}

/**
 * 数据库迁移：检查并添加缺失的列
 */
function migrateAiDatabase(db: Database.Database): void {
  try {
    // 获取 ai_message 表的列信息
    const messageTableInfo = db.pragma('table_info(ai_message)') as Array<{ name: string }>
    const messageColumns = messageTableInfo.map((col) => col.name)

    // 检查并添加 content_blocks 列
    if (!messageColumns.includes('content_blocks')) {
      db.exec('ALTER TABLE ai_message ADD COLUMN content_blocks TEXT')
      console.log('[AI DB Migration] Adding content_blocks column')
    }

    // 检查并添加 token_usage 列（JSON: {promptTokens, completionTokens, totalTokens}）
    if (!messageColumns.includes('token_usage')) {
      db.exec('ALTER TABLE ai_message ADD COLUMN token_usage TEXT')
      console.log('[AI DB Migration] Adding token_usage column to ai_message')
    }

    // 检查并添加 debug_context 列（仅 DEBUG 模式下写入，存储发给 LLM 的完整上下文）
    if (!messageColumns.includes('debug_context')) {
      db.exec('ALTER TABLE ai_message ADD COLUMN debug_context TEXT')
      console.log('[AI DB Migration] Adding debug_context column to ai_message')
    }

    // 获取 ai_conversation 表的列信息
    const convTableInfo = db.pragma('table_info(ai_conversation)') as Array<{ name: string }>
    const convColumns = convTableInfo.map((col) => col.name)

    // 检查并添加 assistant_id 列。
    // 这里只写新默认助手 ID；旧数据由用户手动清理，不在运行时兼容。
    if (!convColumns.includes('assistant_id')) {
      db.exec(`ALTER TABLE ai_conversation ADD COLUMN assistant_id TEXT DEFAULT '${DEFAULT_GENERAL_ID}'`)
      console.log('[AI DB Migration] Adding assistant_id column to ai_conversation')
    }
  } catch (error) {
    console.error('[AI DB Migration] Migration failed:', error)
  }
}

/**
 * 关闭 AI 数据库连接
 */
export function closeAiDatabase(): void {
  if (AI_DB) {
    AI_DB.close()
    AI_DB = null
  }
}

// ==================== Debug: AI DB 直接访问 ====================

/**
 * 获取 AI 数据库的 schema（供 Debug 表格浏览器使用）
 */
export function getAiSchema(): Array<{
  name: string
  columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean }>
}> {
  const db = getAiDb()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>

  return tables.map((t) => {
    const columns = db.pragma(`table_info("${t.name}")`) as Array<{
      name: string
      type: string
      notnull: number
      pk: number
    }>
    return {
      name: t.name,
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        notnull: !!c.notnull,
        pk: !!c.pk,
      })),
    }
  })
}

/**
 * 在 AI 数据库上执行原始 SQL（供 Debug 使用）
 */
export function executeAiSQL(sql: string): {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean
} {
  const db = getAiDb()
  const start = Date.now()
  const trimmed = sql.trim()
  const isSelect = /^SELECT/i.test(trimmed)

  if (isSelect) {
    const stmt = db.prepare(trimmed)
    const rows = stmt.all() as Record<string, any>[]
    const duration = Date.now() - start
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    return {
      columns,
      rows: rows.map((r) => columns.map((c) => r[c])),
      rowCount: rows.length,
      duration,
      limited: false,
    }
  } else {
    const result = db.prepare(trimmed).run()
    const duration = Date.now() - start
    return {
      columns: ['changes', 'lastInsertRowid'],
      rows: [[result.changes, Number(result.lastInsertRowid)]],
      rowCount: 1,
      duration,
      limited: false,
    }
  }
}

// ==================== 类型定义 ====================

/**
 * AI 对话类型
 */
export interface AIConversation {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  createdAt: number
  updatedAt: number
}

/**
 * 内容块类型（用于 AI 消息的混合渲染）
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; tag: string; text: string; durationMs?: number }
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
      }
    }
  | {
      type: 'summary_meta'
      bufferBoundaryTimestamp: number
      compressedMessageCount: number
    }

/**
 * AI 消息类型
 */
export type AIMessageRole = 'user' | 'assistant' | 'summary'

export interface TokenUsageData {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AIMessage {
  id: string
  conversationId: string
  role: AIMessageRole
  content: string
  timestamp: number
  dataKeywords?: string[]
  dataMessageCount?: number
  /** AI 消息的内容块数组（按时序排列的文本和工具调用） */
  contentBlocks?: ContentBlock[]
  /** 本次 Agent 执行的 token 使用量（仅 assistant 消息） */
  tokenUsage?: TokenUsageData
}

// ==================== 对话管理 ====================

/**
 * 创建新对话
 */
export function createConversation(sessionId: string, title: string | undefined, assistantId: string): AIConversation {
  const db = getAiDb()
  const now = Math.floor(Date.now() / 1000)
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  db.prepare(
    `
    INSERT INTO ai_conversation (id, session_id, title, assistant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(id, sessionId, title || null, assistantId, now, now)

  return {
    id,
    sessionId,
    title: title || null,
    assistantId,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 获取会话的所有对话列表
 */
/**
 * 获取所有会话的 AI 对话计数（按 session_id 分组）
 */
export function getConversationCountsBySession(): Map<string, number> {
  const result = new Map<string, number>()
  try {
    const db = getAiDb()
    const rows = db
      .prepare('SELECT session_id, COUNT(*) as count FROM ai_conversation GROUP BY session_id')
      .all() as Array<{ session_id: string; count: number }>
    for (const row of rows) {
      result.set(row.session_id, row.count)
    }
  } catch {
    // AI 数据库可能尚未初始化
  }
  return result
}

export function getConversations(sessionId: string): AIConversation[] {
  const db = getAiDb()

  const rows = db
    .prepare(
      `
    SELECT id, session_id as sessionId, title, assistant_id as assistantId, created_at as createdAt, updated_at as updatedAt
    FROM ai_conversation
    WHERE session_id = ?
    ORDER BY updated_at DESC
  `
    )
    .all(sessionId) as AIConversation[]

  return rows
}

/**
 * 获取单个对话
 */
export function getConversation(conversationId: string): AIConversation | null {
  const db = getAiDb()

  const row = db
    .prepare(
      `
    SELECT id, session_id as sessionId, title, assistant_id as assistantId, created_at as createdAt, updated_at as updatedAt
    FROM ai_conversation
    WHERE id = ?
  `
    )
    .get(conversationId) as AIConversation | undefined

  return row || null
}

/**
 * 更新对话标题
 */
export function updateConversationTitle(conversationId: string, title: string): boolean {
  const db = getAiDb()
  const now = Math.floor(Date.now() / 1000)

  const result = db
    .prepare(
      `
    UPDATE ai_conversation
    SET title = ?, updated_at = ?
    WHERE id = ?
  `
    )
    .run(title, now, conversationId)

  return result.changes > 0
}

/**
 * 删除对话（级联删除消息）
 */
export function deleteConversation(conversationId: string): boolean {
  const db = getAiDb()

  // 先删除消息
  db.prepare('DELETE FROM ai_message WHERE conversation_id = ?').run(conversationId)
  // 再删除对话
  const result = db.prepare('DELETE FROM ai_conversation WHERE id = ?').run(conversationId)

  return result.changes > 0
}

// ==================== 消息管理 ====================

/**
 * 添加消息到对话
 */
export function addMessage(
  conversationId: string,
  role: AIMessageRole,
  content: string,
  dataKeywords?: string[],
  dataMessageCount?: number,
  contentBlocks?: ContentBlock[],
  tokenUsage?: TokenUsageData
): AIMessage {
  const db = getAiDb()
  const now = Math.floor(Date.now() / 1000)
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // 检查是否有暂存的 debug context 需要写入（仅 assistant 消息）
  const pendingDebug = role === 'assistant' ? pendingDebugContextMap.get(conversationId) : undefined
  if (pendingDebug) {
    pendingDebugContextMap.delete(conversationId)
  }

  db.prepare(
    `
    INSERT INTO ai_message (id, conversation_id, role, content, timestamp, data_keywords, data_message_count, content_blocks, token_usage, debug_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    conversationId,
    role,
    content,
    now,
    dataKeywords ? JSON.stringify(dataKeywords) : null,
    dataMessageCount ?? null,
    contentBlocks ? JSON.stringify(contentBlocks) : null,
    tokenUsage ? JSON.stringify(tokenUsage) : null,
    pendingDebug ?? null
  )

  // 更新对话的 updated_at
  db.prepare('UPDATE ai_conversation SET updated_at = ? WHERE id = ?').run(now, conversationId)

  return {
    id,
    conversationId,
    role,
    content,
    timestamp: now,
    dataKeywords,
    dataMessageCount,
    contentBlocks,
    tokenUsage,
  }
}

/**
 * 获取对话的所有消息
 */
export function getMessages(conversationId: string): AIMessage[] {
  const db = getAiDb()

  const rows = db
    .prepare(
      `
    SELECT
      id,
      conversation_id as conversationId,
      role,
      content,
      timestamp,
      data_keywords as dataKeywords,
      data_message_count as dataMessageCount,
      content_blocks as contentBlocks,
      token_usage as tokenUsage
    FROM ai_message
    WHERE conversation_id = ?
    ORDER BY timestamp ASC
  `
    )
    .all(conversationId) as Array<{
    id: string
    conversationId: string
    role: string
    content: string
    timestamp: number
    dataKeywords: string | null
    dataMessageCount: number | null
    contentBlocks: string | null
    tokenUsage: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as AIMessageRole,
    content: row.content,
    timestamp: row.timestamp,
    dataKeywords: row.dataKeywords ? JSON.parse(row.dataKeywords) : undefined,
    dataMessageCount: row.dataMessageCount ?? undefined,
    contentBlocks: row.contentBlocks ? JSON.parse(row.contentBlocks) : undefined,
    tokenUsage: row.tokenUsage ? JSON.parse(row.tokenUsage) : undefined,
  }))
}

/**
 * 删除单条消息
 */
export function deleteMessage(messageId: string): boolean {
  const db = getAiDb()
  const result = db.prepare('DELETE FROM ai_message WHERE id = ?').run(messageId)
  return result.changes > 0
}

/**
 * 暂存 debug context，等待下一次 addMessage(assistant) 时自动写入
 */
export function setPendingDebugContext(conversationId: string, debugContext: string): void {
  pendingDebugContextMap.set(conversationId, debugContext)
}

/**
 * 更新消息的 debug_context 字段（仅 DEBUG 模式下调用）
 */
export function setDebugContext(messageId: string, debugContext: string): void {
  const db = getAiDb()
  db.prepare('UPDATE ai_message SET debug_context = ? WHERE id = ?').run(debugContext, messageId)
}

/**
 * 一键清除所有消息的 debug_context 数据
 */
export function clearAllDebugContext(): number {
  const db = getAiDb()
  const result = db.prepare('UPDATE ai_message SET debug_context = NULL WHERE debug_context IS NOT NULL').run()
  return result.changes
}

/**
 * 获取对话的累计 token 使用量（聚合所有 assistant 消息的 token_usage）
 */
export function getConversationTokenUsage(conversationId: string): TokenUsageData {
  const db = getAiDb()
  const row = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(json_extract(token_usage, '$.promptTokens')), 0) as promptTokens,
      COALESCE(SUM(json_extract(token_usage, '$.completionTokens')), 0) as completionTokens,
      COALESCE(SUM(json_extract(token_usage, '$.totalTokens')), 0) as totalTokens
    FROM ai_message
    WHERE conversation_id = ? AND token_usage IS NOT NULL
  `
    )
    .get(conversationId) as { promptTokens: number; completionTokens: number; totalTokens: number }

  return {
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
  }
}

// ==================== Agent 专用 ====================

/**
 * 为 Agent 提供对话历史
 *
 * 返回简化的 {role, content} 格式，按时间升序排列。
 * 当存在 summary 消息时，返回：[summary] + [buffer 消息] + [新消息]。
 * Buffer 边界从 summary 的 content_blocks 中的 summary_meta block 获取。
 *
 * @param conversationId 对话 ID
 * @param maxMessages 最大返回条数（取最近 N 条，仅对 buffer+新消息生效）
 */
export function getHistoryForAgent(
  conversationId: string,
  maxMessages?: number
): Array<{ role: 'user' | 'assistant' | 'summary'; content: string }> {
  const messages = getMessages(conversationId)
  const validMessages = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant' || m.role === 'summary') && m.content?.trim()
  )

  // 查找最新的 summary 消息
  let summaryMsg: AIMessage | undefined
  for (let i = validMessages.length - 1; i >= 0; i--) {
    if (validMessages[i].role === 'summary') {
      summaryMsg = validMessages[i]
      break
    }
  }

  let result: Array<{ role: 'user' | 'assistant' | 'summary'; content: string }>

  if (summaryMsg) {
    // 从 content_blocks 中解析 summary_meta 获取 buffer 边界
    const metaBlock = summaryMsg.contentBlocks?.find(
      (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
    )
    const bufferBoundary = metaBlock?.bufferBoundaryTimestamp

    if (!metaBlock) {
      aiLogger.warn('Conversations', 'summary message missing summary_meta; agent context will be summary-only', {
        conversationId,
        messageId: summaryMsg.id,
      })
    }

    // 取 timestamp >= boundary 的 user/assistant 消息（buffer + 新消息）
    const contextMessages = bufferBoundary
      ? validMessages.filter((m) => m.role !== 'summary' && m.timestamp >= bufferBoundary)
      : []

    result = [
      { role: 'summary' as const, content: summaryMsg.content },
      ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
    ]
  } else {
    result = validMessages.map((m) => ({ role: m.role, content: m.content }))
  }

  if (maxMessages && result.length > maxMessages) {
    if (result.length > 0 && result[0].role === 'summary') {
      const rest = result.slice(1)
      const truncated = rest.slice(-(maxMessages - 1))
      return [result[0], ...truncated]
    }
    return result.slice(-maxMessages)
  }
  return result
}

// ==================== Summary / 压缩专用 ====================

/**
 * 添加 summary 消息并替换旧的 summary（每个对话只保留一条最新压缩摘要）
 *
 * Summary 时间戳 = NOW（UI 中显示在触发压缩的位置）。
 * Buffer 边界信息存入 content_blocks 的 summary_meta block 中，供 getHistoryForAgent 使用。
 */
export function addSummaryMessage(
  conversationId: string,
  content: string,
  meta: { bufferBoundaryTimestamp: number; compressedMessageCount: number }
): AIMessage {
  const db = getAiDb()

  db.prepare("DELETE FROM ai_message WHERE conversation_id = ? AND role = 'summary'").run(conversationId)

  const contentBlocks: ContentBlock[] = [
    {
      type: 'summary_meta',
      bufferBoundaryTimestamp: meta.bufferBoundaryTimestamp,
      compressedMessageCount: meta.compressedMessageCount,
    },
  ]

  return addMessage(conversationId, 'summary', content, undefined, undefined, contentBlocks)
}

/**
 * 获取对话中最新的 summary 消息
 */
export function getLatestSummary(conversationId: string): AIMessage | null {
  const db = getAiDb()
  const row = db
    .prepare(
      `
    SELECT id, conversation_id as conversationId, role, content, timestamp,
           data_keywords as dataKeywords, data_message_count as dataMessageCount, content_blocks as contentBlocks
    FROM ai_message
    WHERE conversation_id = ? AND role = 'summary'
    ORDER BY timestamp DESC
    LIMIT 1
  `
    )
    .get(conversationId) as
    | {
        id: string
        conversationId: string
        role: string
        content: string
        timestamp: number
        dataKeywords: string | null
        dataMessageCount: number | null
        contentBlocks: string | null
      }
    | undefined

  if (!row) return null
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as AIMessageRole,
    content: row.content,
    timestamp: row.timestamp,
    dataKeywords: row.dataKeywords ? JSON.parse(row.dataKeywords) : undefined,
    dataMessageCount: row.dataMessageCount ?? undefined,
    contentBlocks: row.contentBlocks ? JSON.parse(row.contentBlocks) : undefined,
  }
}

/**
 * 获取 system（压缩摘要）之后的所有 user/assistant 消息（用于压缩计算）
 */
export function getMessagesAfterSummary(
  conversationId: string,
  summaryTimestamp: number
): Array<{ role: AIMessageRole; content: string; timestamp: number }> {
  const db = getAiDb()
  const rows = db
    .prepare(
      `
    SELECT role, content, timestamp
    FROM ai_message
    WHERE conversation_id = ? AND timestamp > ? AND role IN ('user', 'assistant')
    ORDER BY timestamp ASC
  `
    )
    .all(conversationId, summaryTimestamp) as Array<{
    role: string
    content: string
    timestamp: number
  }>

  return rows.map((r) => ({ role: r.role as AIMessageRole, content: r.content, timestamp: r.timestamp }))
}

/**
 * 获取对话中所有 user/assistant 消息（不含 summary，用于首次压缩）
 */
export function getAllUserAssistantMessages(
  conversationId: string
): Array<{ role: AIMessageRole; content: string; timestamp: number }> {
  const db = getAiDb()
  const rows = db
    .prepare(
      `
    SELECT role, content, timestamp
    FROM ai_message
    WHERE conversation_id = ? AND role IN ('user', 'assistant')
    ORDER BY timestamp ASC
  `
    )
    .all(conversationId) as Array<{
    role: string
    content: string
    timestamp: number
  }>

  return rows.map((r) => ({ role: r.role as AIMessageRole, content: r.content, timestamp: r.timestamp }))
}

/**
 * 获取对话中 summary 之后的 user/assistant 消息数量
 */
export function getMessageCountAfterSummary(conversationId: string): number {
  const summary = getLatestSummary(conversationId)
  if (!summary) {
    const db = getAiDb()
    const row = db
      .prepare("SELECT COUNT(*) as count FROM ai_message WHERE conversation_id = ? AND role IN ('user', 'assistant')")
      .get(conversationId) as { count: number }
    return row.count
  }

  // 从 summary_meta 获取 buffer 边界，统计 >= boundary 的消息数
  const metaBlock = summary.contentBlocks?.find(
    (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
  )
  const boundary = metaBlock?.bufferBoundaryTimestamp ?? summary.timestamp

  const db = getAiDb()
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM ai_message WHERE conversation_id = ? AND timestamp >= ? AND role IN ('user', 'assistant')"
    )
    .get(conversationId, boundary) as { count: number }
  return row.count
}
