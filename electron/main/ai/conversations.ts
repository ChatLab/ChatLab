/**
 * AI 对话历史管理模块
 * 在主进程中执行，管理 AI 对话的持久化存储
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import { getAiDataDir, ensureDir } from '../paths'

const DEFAULT_GENERAL_ID = 'general_cn'

// AI 数据库实例
let AI_DB: Database.Database | null = null

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
  | { type: 'think'; tag: string; text: string; durationMs?: number } // 思考内容块
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
      }
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

  db.prepare(
    `
    INSERT INTO ai_message (id, conversation_id, role, content, timestamp, data_keywords, data_message_count, content_blocks, token_usage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    tokenUsage ? JSON.stringify(tokenUsage) : null
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
 * 当存在 summary 消息时，返回最新 summary + summary 之后的 user/assistant 消息，
 * 以避免重复加载已被压缩的旧消息。
 *
 * @param conversationId 对话 ID
 * @param maxMessages 最大返回条数（取最近 N 条，仅对 summary 之后的消息生效）
 */
export function getHistoryForAgent(
  conversationId: string,
  maxMessages?: number
): Array<{ role: 'user' | 'assistant' | 'summary'; content: string }> {
  const messages = getMessages(conversationId)
  const validMessages = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant' || m.role === 'summary') && m.content?.trim()
  )

  // 查找最新的 summary 消息位置
  let summaryIndex = -1
  for (let i = validMessages.length - 1; i >= 0; i--) {
    if (validMessages[i].role === 'summary') {
      summaryIndex = i
      break
    }
  }

  let result: Array<{ role: 'user' | 'assistant' | 'summary'; content: string }>

  if (summaryIndex >= 0) {
    // 返回 summary + summary 之后的消息
    result = validMessages.slice(summaryIndex).map((m) => ({ role: m.role, content: m.content }))
  } else {
    result = validMessages.map((m) => ({ role: m.role, content: m.content }))
  }

  if (maxMessages && result.length > maxMessages) {
    // 如果有 summary 且它是第一条，保留它再截取后面的
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
 * 添加 summary 消息并替换旧的 summary（每个对话只保留一条最新 summary）
 */
export function addSummaryMessage(conversationId: string, content: string): AIMessage {
  const db = getAiDb()

  // 删除该对话中所有旧的 summary 消息
  db.prepare("DELETE FROM ai_message WHERE conversation_id = ? AND role = 'summary'").run(conversationId)

  return addMessage(conversationId, 'summary', content)
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
 * 获取 summary 之后的所有 user/assistant 消息（用于压缩计算）
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
  const db = getAiDb()
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM ai_message WHERE conversation_id = ? AND timestamp > ? AND role IN ('user', 'assistant')"
    )
    .get(conversationId, summary.timestamp) as { count: number }
  return row.count
}
