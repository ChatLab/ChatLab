/**
 * AI 对话历史管理模块（平台无关）
 *
 * 管理 AI 对话的持久化存储（conversations.db），
 * 供 Electron 主进程和 CLI serve 共用。
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { ChartPayload, ChatEvidencePayload } from '@openchatlab/core'
import type { PlanContentBlock, PlanDraftContentBlock } from './agent'

const DEFAULT_GENERAL_ID = 'general_cn'

// ==================== 类型定义 ====================

export interface AIChat {
  id: string
  sessionId: string
  title: string | null
  assistantId: string
  activeMessageId?: string | null
  createdAt: number
  updatedAt: number
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'think'; tag: string; text: string; durationMs?: number }
  | { type: 'chart'; chart: ChartPayload }
  | { type: 'evidence'; evidence: ChatEvidencePayload }
  | PlanContentBlock
  | PlanDraftContentBlock
  | {
      type: 'tool'
      tool: {
        name: string
        displayName: string
        status: 'running' | 'done' | 'error'
        params?: Record<string, unknown>
        /** Provider-issued tool call id, persisted so history replay keeps stable ids (prompt cache friendly). */
        toolCallId?: string
        /** Truncated text of the tool result as seen by the model. Absent on legacy rows and unfinished calls. */
        result?: string
        /** Full safe text result for UI display; not used for history replay. */
        displayResult?: string
        /** Whether the tool execution failed (pi-level isError, distinct from UI status). */
        isError?: boolean
      }
    }
  | { type: 'error'; error: { name: string | null; message: string; stack: string | null } }
  | {
      type: 'summary_meta'
      bufferBoundaryTimestamp: number
      compressedMessageCount: number
    }

export type AIMessageRole = 'user' | 'assistant' | 'summary'

export interface TokenUsageData {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface AIMessage {
  id: string
  aiChatId: string
  role: AIMessageRole
  content: string
  timestamp: number
  parentId?: string | null
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: ContentBlock[]
  tokenUsage?: TokenUsageData
}

interface AIMessageRow {
  id: string
  aiChatId: string
  role: string
  content: string
  timestamp: number
  parentId: string | null
  siblingGroupId: string | null
  branchIndex: number | null
  dataKeywords: string | null
  dataMessageCount: number | null
  contentBlocks: string | null
  tokenUsage: string | null
}

export interface AIChatManagerLogger {
  warn(category: string, message: string, extra?: Record<string, unknown>): void
}

const defaultLogger: AIChatManagerLogger = {
  warn(_category, message, extra) {
    console.warn(`[AI Chats] ${message}`, extra ?? '')
  },
}

// ==================== AIChatManager ====================

export class AIChatManager {
  private db: Database.Database | null = null
  private readonly aiDataDir: string
  private readonly logger: AIChatManagerLogger
  private readonly nativeBinding?: string
  private readonly pendingDebugContextMap = new Map<string, string>()

  constructor(aiDataDir: string, options?: { logger?: AIChatManagerLogger; nativeBinding?: string }) {
    this.aiDataDir = aiDataDir
    this.logger = options?.logger ?? defaultLogger
    this.nativeBinding = options?.nativeBinding
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  private getDb(): Database.Database {
    if (this.db) return this.db

    this.ensureDir(this.aiDataDir)
    const dbPath = path.join(this.aiDataDir, 'conversations.db')
    this.db = this.nativeBinding ? new Database(dbPath, { nativeBinding: this.nativeBinding }) : new Database(dbPath)
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_chat (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT,
        assistant_id TEXT DEFAULT '${DEFAULT_GENERAL_ID}',
        active_message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_message (
        id TEXT PRIMARY KEY,
        ai_chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data_keywords TEXT,
        data_message_count INTEGER,
        content_blocks TEXT,
        parent_id TEXT,
        sibling_group_id TEXT,
        branch_index INTEGER DEFAULT 0,
        debug_context TEXT,
        token_usage TEXT,
        FOREIGN KEY(ai_chat_id) REFERENCES ai_chat(id) ON DELETE CASCADE
      );

    `)

    this.migrateDatabase(this.db)
    return this.db
  }

  private tableExists(db: Database.Database, tableName: string): boolean {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as
      | { 1: number }
      | undefined
    return !!row
  }

  private getTableColumns(db: Database.Database, tableName: string): string[] {
    const tableInfo = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
    return tableInfo.map((col) => col.name)
  }

  private ensureMessageMigrationColumns(db: Database.Database, tableName: string): void {
    const messageColumns = this.getTableColumns(db, tableName)
    if (!messageColumns.includes('content_blocks')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN content_blocks TEXT`)
    }
    if (!messageColumns.includes('token_usage')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN token_usage TEXT`)
    }
    if (!messageColumns.includes('debug_context')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN debug_context TEXT`)
    }
    if (!messageColumns.includes('parent_id')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN parent_id TEXT`)
    }
    if (!messageColumns.includes('sibling_group_id')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN sibling_group_id TEXT`)
    }
    if (!messageColumns.includes('branch_index')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN branch_index INTEGER DEFAULT 0`)
    }
  }

  private migrateDatabase(db: Database.Database): void {
    try {
      const hasLegacyConversationTable = this.tableExists(db, 'ai_conversation')

      if (hasLegacyConversationTable) {
        const convColumns = this.getTableColumns(db, 'ai_conversation')
        if (!convColumns.includes('assistant_id')) {
          db.exec(`ALTER TABLE ai_conversation ADD COLUMN assistant_id TEXT DEFAULT '${DEFAULT_GENERAL_ID}'`)
        }
        if (!convColumns.includes('active_message_id')) {
          db.exec('ALTER TABLE ai_conversation ADD COLUMN active_message_id TEXT')
        }

        db.exec(`
          INSERT OR IGNORE INTO ai_chat (
            id, session_id, title, assistant_id, active_message_id, created_at, updated_at
          )
          SELECT id, session_id, title, COALESCE(assistant_id, '${DEFAULT_GENERAL_ID}'),
                 active_message_id, created_at, updated_at
          FROM ai_conversation
        `)
      }

      this.ensureMessageMigrationColumns(db, 'ai_message')

      const messageColumns = this.getTableColumns(db, 'ai_message')
      const hadLegacyConversationId = messageColumns.includes('conversation_id')
      const needsMessageTreeBackfill =
        !messageColumns.includes('parent_id') ||
        !messageColumns.includes('sibling_group_id') ||
        !messageColumns.includes('branch_index') ||
        hadLegacyConversationId

      if (hadLegacyConversationId && !messageColumns.includes('ai_chat_id')) {
        db.exec(`
          DROP INDEX IF EXISTS idx_ai_message_conversation;
          ALTER TABLE ai_message RENAME TO ai_message_legacy;

          CREATE TABLE ai_message (
            id TEXT PRIMARY KEY,
            ai_chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            data_keywords TEXT,
            data_message_count INTEGER,
            content_blocks TEXT,
            parent_id TEXT,
            sibling_group_id TEXT,
            branch_index INTEGER DEFAULT 0,
            debug_context TEXT,
            token_usage TEXT,
            FOREIGN KEY(ai_chat_id) REFERENCES ai_chat(id) ON DELETE CASCADE
          );

          INSERT INTO ai_message (
            id, ai_chat_id, role, content, timestamp, data_keywords, data_message_count,
            content_blocks, parent_id, sibling_group_id, branch_index, debug_context, token_usage
          )
          SELECT id, conversation_id, role, content, timestamp, data_keywords, data_message_count,
                 content_blocks, parent_id, sibling_group_id, branch_index, debug_context, token_usage
          FROM ai_message_legacy;

          DROP TABLE ai_message_legacy;
        `)
      }

      if (hasLegacyConversationTable) {
        db.exec(`
          DROP INDEX IF EXISTS idx_ai_conversation_session;
          DROP TABLE ai_conversation;
        `)
      }

      if (needsMessageTreeBackfill || this.hasUnbackfilledMessageTree(db)) {
        this.backfillMessageTree(db)
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ai_chat_session ON ai_chat(session_id);
        CREATE INDEX IF NOT EXISTS idx_ai_message_ai_chat ON ai_message(ai_chat_id);
        CREATE INDEX IF NOT EXISTS idx_ai_message_parent ON ai_message(parent_id);
        CREATE INDEX IF NOT EXISTS idx_ai_message_sibling ON ai_message(sibling_group_id);
      `)
    } catch (error) {
      console.error('[AI DB Migration] Migration failed:', error)
    }
  }

  private hasUnbackfilledMessageTree(db: Database.Database): boolean {
    const row = db
      .prepare(
        `SELECT 1
         FROM ai_chat c
         WHERE EXISTS (
           SELECT 1 FROM ai_message m
           WHERE m.ai_chat_id = c.id
         )
         AND (
           c.active_message_id IS NULL
           OR EXISTS (
             SELECT 1 FROM ai_message m
             WHERE m.ai_chat_id = c.id
               AND (m.sibling_group_id IS NULL OR m.branch_index IS NULL)
           )
         )
         LIMIT 1`
      )
      .get()
    return !!row
  }

  private backfillMessageTree(db: Database.Database): void {
    const aiChats = db.prepare('SELECT id FROM ai_chat').all() as Array<{ id: string }>
    const updateMessage = db.prepare(
      'UPDATE ai_message SET parent_id = ?, sibling_group_id = COALESCE(sibling_group_id, ?), branch_index = COALESCE(branch_index, 0) WHERE id = ?'
    )
    const updateAIChat = db.prepare('UPDATE ai_chat SET active_message_id = ? WHERE id = ?')

    const tx = db.transaction(() => {
      for (const aiChat of aiChats) {
        const messages = db
          .prepare(
            `SELECT id, parent_id as parentId, sibling_group_id as siblingGroupId
             FROM ai_message WHERE ai_chat_id = ? ORDER BY timestamp ASC, id ASC`
          )
          .all(aiChat.id) as Array<{ id: string; parentId: string | null; siblingGroupId: string | null }>

        let previousId: string | null = null
        for (const message of messages) {
          const parentId = message.parentId === undefined ? previousId : (message.parentId ?? previousId)
          updateMessage.run(parentId, message.siblingGroupId ?? message.id, message.id)
          previousId = message.id
        }

        const aiChatRow = db
          .prepare('SELECT active_message_id as activeMessageId FROM ai_chat WHERE id = ?')
          .get(aiChat.id) as { activeMessageId: string | null } | undefined
        if (!aiChatRow?.activeMessageId && previousId) {
          updateAIChat.run(previousId, aiChat.id)
        }
      }
    })

    tx()
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  private parseMessageRow(row: AIMessageRow): AIMessage {
    return {
      id: row.id,
      aiChatId: row.aiChatId,
      role: row.role as AIMessageRole,
      content: row.content,
      timestamp: row.timestamp,
      parentId: row.parentId ?? null,
      dataKeywords: row.dataKeywords ? JSON.parse(row.dataKeywords) : undefined,
      dataMessageCount: row.dataMessageCount ?? undefined,
      contentBlocks: row.contentBlocks ? JSON.parse(row.contentBlocks) : undefined,
      tokenUsage: row.tokenUsage ? JSON.parse(row.tokenUsage) : undefined,
    }
  }

  private getMessageRow(messageId: string): AIMessageRow | null {
    const db = this.getDb()
    const row = db
      .prepare(
        `SELECT id, ai_chat_id as aiChatId, role, content, timestamp,
                parent_id as parentId, sibling_group_id as siblingGroupId, branch_index as branchIndex,
                data_keywords as dataKeywords, data_message_count as dataMessageCount,
                content_blocks as contentBlocks, token_usage as tokenUsage
         FROM ai_message WHERE id = ?`
      )
      .get(messageId) as AIMessageRow | undefined
    return row ?? null
  }

  private getActiveMessageId(aiChatId: string): string | null {
    const db = this.getDb()
    const row = db.prepare('SELECT active_message_id as activeMessageId FROM ai_chat WHERE id = ?').get(aiChatId) as
      | { activeMessageId: string | null }
      | undefined
    if (row?.activeMessageId) {
      const activeExists = db.prepare('SELECT 1 FROM ai_message WHERE id = ?').get(row.activeMessageId)
      if (activeExists) return row.activeMessageId
    }

    const fallback = db
      .prepare('SELECT id FROM ai_message WHERE ai_chat_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1')
      .get(aiChatId) as { id: string } | undefined
    if (fallback?.id) {
      db.prepare('UPDATE ai_chat SET active_message_id = ? WHERE id = ?').run(fallback.id, aiChatId)
      return fallback.id
    }
    return null
  }

  private getAllMessageRows(aiChatId: string): AIMessageRow[] {
    return this.getDb()
      .prepare(
        `SELECT id, ai_chat_id as aiChatId, role, content, timestamp,
                parent_id as parentId, sibling_group_id as siblingGroupId, branch_index as branchIndex,
                data_keywords as dataKeywords, data_message_count as dataMessageCount,
                content_blocks as contentBlocks, token_usage as tokenUsage
         FROM ai_message WHERE ai_chat_id = ? ORDER BY timestamp ASC, id ASC`
      )
      .all(aiChatId) as AIMessageRow[]
  }

  private getActivePathRows(aiChatId: string, leafMessageId?: string | null): AIMessageRow[] {
    if (leafMessageId === null) return []

    const allRows = this.getAllMessageRows(aiChatId)
    if (allRows.length === 0) return []

    const rowMap = new Map(allRows.map((row) => [row.id, row]))
    let currentId = leafMessageId ?? this.getActiveMessageId(aiChatId)
    const path: AIMessageRow[] = []
    const seen = new Set<string>()

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const row = rowMap.get(currentId)
      if (!row) break
      path.push(row)
      currentId = row.parentId
    }

    return path.length > 0 ? path.reverse() : allRows
  }

  // ==================== 生命周期 ====================

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  // ==================== Debug ====================

  getAiSchema(): Array<{
    name: string
    columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean }>
  }> {
    const db = this.getDb()
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

  executeAiSQL(sql: string): {
    columns: string[]
    rows: unknown[][]
    rowCount: number
    duration: number
    limited: boolean
  } {
    const db = this.getDb()
    const start = Date.now()
    const trimmed = sql.trim()
    const isSelect = /^SELECT/i.test(trimmed)

    if (isSelect) {
      const stmt = db.prepare(trimmed)
      const rows = stmt.all() as Record<string, unknown>[]
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

  // ==================== 对话管理 ====================

  createAIChat(sessionId: string, title: string | undefined, assistantId: string): AIChat {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId('conv')

    db.prepare(
      `INSERT INTO ai_chat (id, session_id, title, assistant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, title || null, assistantId, now, now)

    return { id, sessionId, title: title || null, assistantId, activeMessageId: null, createdAt: now, updatedAt: now }
  }

  getAIChatCountsBySession(): Map<string, number> {
    const result = new Map<string, number>()
    try {
      const db = this.getDb()
      const rows = db.prepare('SELECT session_id, COUNT(*) as count FROM ai_chat GROUP BY session_id').all() as Array<{
        session_id: string
        count: number
      }>
      for (const row of rows) {
        result.set(row.session_id, row.count)
      }
    } catch {
      // AI DB may not be initialized yet
    }
    return result
  }

  getAIChats(sessionId: string): AIChat[] {
    const db = this.getDb()
    return db
      .prepare(
        `SELECT id, session_id as sessionId, title, assistant_id as assistantId,
                active_message_id as activeMessageId,
                created_at as createdAt, updated_at as updatedAt
         FROM ai_chat WHERE session_id = ? ORDER BY updated_at DESC`
      )
      .all(sessionId) as AIChat[]
  }

  getAIChat(aiChatId: string): AIChat | null {
    const db = this.getDb()
    const row = db
      .prepare(
        `SELECT id, session_id as sessionId, title, assistant_id as assistantId,
                active_message_id as activeMessageId,
                created_at as createdAt, updated_at as updatedAt
         FROM ai_chat WHERE id = ?`
      )
      .get(aiChatId) as AIChat | undefined
    return row || null
  }

  updateAIChatTitle(aiChatId: string, title: string): boolean {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare('UPDATE ai_chat SET title = ?, updated_at = ? WHERE id = ?').run(title, now, aiChatId)
    return result.changes > 0
  }

  deleteAIChat(aiChatId: string): boolean {
    const db = this.getDb()
    db.prepare('DELETE FROM ai_message WHERE ai_chat_id = ?').run(aiChatId)
    const result = db.prepare('DELETE FROM ai_chat WHERE id = ?').run(aiChatId)
    return result.changes > 0
  }

  // ==================== 消息管理 ====================

  addMessage(
    aiChatId: string,
    role: AIMessageRole,
    content: string,
    dataKeywords?: string[],
    dataMessageCount?: number,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): AIMessage {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId('msg')
    const parentId = this.getActiveMessageId(aiChatId)
    const siblingGroupId = id
    const branchIndex = 0

    const pendingDebug = role === 'assistant' ? this.pendingDebugContextMap.get(aiChatId) : undefined
    if (pendingDebug) {
      this.pendingDebugContextMap.delete(aiChatId)
    }

    db.prepare(
      `INSERT INTO ai_message (
         id, ai_chat_id, role, content, timestamp, data_keywords, data_message_count,
         content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      aiChatId,
      role,
      content,
      now,
      dataKeywords ? JSON.stringify(dataKeywords) : null,
      dataMessageCount ?? null,
      contentBlocks ? JSON.stringify(contentBlocks) : null,
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      pendingDebug ?? null,
      parentId,
      siblingGroupId,
      branchIndex
    )

    db.prepare('UPDATE ai_chat SET active_message_id = ?, updated_at = ? WHERE id = ?').run(id, now, aiChatId)

    return {
      id,
      aiChatId,
      role,
      content,
      timestamp: now,
      parentId,
      dataKeywords,
      dataMessageCount,
      contentBlocks,
      tokenUsage,
    }
  }

  getMessages(aiChatId: string): AIMessage[] {
    return this.getActivePathRows(aiChatId).map((row) => this.parseMessageRow(row))
  }

  deleteMessage(messageId: string): boolean {
    const db = this.getDb()
    const result = db.prepare('DELETE FROM ai_message WHERE id = ?').run(messageId)
    return result.changes > 0
  }

  deleteMessagesFrom(aiChatId: string, messageId: string): void {
    const db = this.getDb()
    const target = this.getMessageRow(messageId)
    if (!target || target.aiChatId !== aiChatId) {
      throw new Error('Message not found in AI chat')
    }

    const activePath = this.getActivePathRows(aiChatId)
    const targetIndex = activePath.findIndex((row) => row.id === messageId)
    if (targetIndex < 0) {
      throw new Error('Message not on active path')
    }

    const idsToDelete = activePath.slice(targetIndex).map((row) => row.id)
    const placeholders = idsToDelete.map(() => '?').join(', ')
    db.prepare(`DELETE FROM ai_message WHERE id IN (${placeholders})`).run(...idsToDelete)

    const newLeafId = targetIndex > 0 ? activePath[targetIndex - 1]!.id : null
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE ai_chat SET active_message_id = ?, updated_at = ? WHERE id = ?').run(newLeafId, now, aiChatId)
  }

  forkAIChat(sourceAIChatId: string, upToMessageId: string, title?: string): AIChat {
    const db = this.getDb()
    const source = this.getAIChat(sourceAIChatId)
    if (!source) {
      throw new Error('Source AI chat not found')
    }

    const activePath = this.getActivePathRows(sourceAIChatId)
    const cutIndex = activePath.findIndex((row) => row.id === upToMessageId)
    if (cutIndex < 0) {
      throw new Error('Message not on active path')
    }

    const messagesToCopy = activePath.slice(0, cutIndex + 1)
    const now = Math.floor(Date.now() / 1000)
    const newConvId = this.generateId('conv')
    const forkTitle = title || `${source.title || 'Untitled'} (fork)`

    db.prepare(
      `INSERT INTO ai_chat (id, session_id, title, assistant_id, active_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    ).run(newConvId, source.sessionId, forkTitle, source.assistantId, now, now)

    const idMap = new Map<string, string>()
    let lastNewId: string | null = null

    for (const row of messagesToCopy) {
      const newMsgId = this.generateId('msg')
      idMap.set(row.id, newMsgId)
      const newParentId = row.parentId ? (idMap.get(row.parentId) ?? null) : null

      db.prepare(
        `INSERT INTO ai_message (
           id, ai_chat_id, role, content, timestamp, data_keywords, data_message_count,
           content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0)`
      ).run(
        newMsgId,
        newConvId,
        row.role,
        row.content,
        row.timestamp,
        row.dataKeywords,
        row.dataMessageCount,
        row.contentBlocks,
        row.tokenUsage,
        newParentId,
        newMsgId
      )
      lastNewId = newMsgId
    }

    if (lastNewId) {
      db.prepare('UPDATE ai_chat SET active_message_id = ? WHERE id = ?').run(lastNewId, newConvId)
    }

    return {
      id: newConvId,
      sessionId: source.sessionId,
      title: forkTitle,
      assistantId: source.assistantId,
      activeMessageId: lastNewId,
      createdAt: now,
      updatedAt: now,
    }
  }

  updateMessageContent(messageId: string, newContent: string): void {
    const db = this.getDb()
    const result = db.prepare('UPDATE ai_message SET content = ? WHERE id = ?').run(newContent, messageId)
    if (result.changes === 0) throw new Error('Message not found')
  }

  deleteAndRelinkMessage(aiChatId: string, messageId: string): void {
    const db = this.getDb()
    const target = this.getMessageRow(messageId)
    if (!target || target.aiChatId !== aiChatId) {
      throw new Error('Message not found in AI chat')
    }

    db.prepare('UPDATE ai_message SET parent_id = ? WHERE parent_id = ? AND ai_chat_id = ?').run(
      target.parentId,
      messageId,
      aiChatId
    )

    const conv = this.getAIChat(aiChatId)
    if (conv?.activeMessageId === messageId) {
      const now = Math.floor(Date.now() / 1000)
      db.prepare('UPDATE ai_chat SET active_message_id = ?, updated_at = ? WHERE id = ?').run(
        target.parentId,
        now,
        aiChatId
      )
    }

    db.prepare('DELETE FROM ai_message WHERE id = ?').run(messageId)
  }

  insertMessageAfter(
    aiChatId: string,
    afterMessageId: string,
    role: AIMessageRole,
    content: string,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): AIMessage {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId('msg')

    const pendingDebug = role === 'assistant' ? this.pendingDebugContextMap.get(aiChatId) : undefined
    if (pendingDebug) {
      this.pendingDebugContextMap.delete(aiChatId)
    }

    const childRow = db
      .prepare('SELECT id FROM ai_message WHERE parent_id = ? AND ai_chat_id = ? LIMIT 1')
      .get(afterMessageId, aiChatId) as { id: string } | undefined

    db.prepare(
      `INSERT INTO ai_message (
         id, ai_chat_id, role, content, timestamp, data_keywords, data_message_count,
         content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
       )
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      aiChatId,
      role,
      content,
      now,
      contentBlocks ? JSON.stringify(contentBlocks) : null,
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      pendingDebug ?? null,
      afterMessageId,
      id
    )

    if (childRow) {
      db.prepare('UPDATE ai_message SET parent_id = ? WHERE id = ?').run(id, childRow.id)
      db.prepare('UPDATE ai_chat SET updated_at = ? WHERE id = ?').run(now, aiChatId)
    } else {
      db.prepare('UPDATE ai_chat SET active_message_id = ?, updated_at = ? WHERE id = ?').run(id, now, aiChatId)
    }

    return {
      id,
      aiChatId,
      role,
      content,
      timestamp: now,
      parentId: afterMessageId,
      contentBlocks,
      tokenUsage,
    }
  }

  getAIChatTokenUsage(aiChatId: string): TokenUsageData {
    const rows = this.getActivePathRows(aiChatId)
    const result: TokenUsageData = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    for (const row of rows) {
      if (row.tokenUsage) {
        const usage = JSON.parse(row.tokenUsage) as TokenUsageData
        result.promptTokens += usage.promptTokens
        result.completionTokens += usage.completionTokens
        result.totalTokens += usage.totalTokens
        result.cacheReadTokens! += usage.cacheReadTokens || 0
        result.cacheWriteTokens! += usage.cacheWriteTokens || 0
      }
    }
    return result
  }

  // ==================== Debug context ====================

  setPendingDebugContext(aiChatId: string, debugContext: string): void {
    this.pendingDebugContextMap.set(aiChatId, debugContext)
  }

  setDebugContext(messageId: string, debugContext: string): void {
    const db = this.getDb()
    db.prepare('UPDATE ai_message SET debug_context = ? WHERE id = ?').run(debugContext, messageId)
  }

  clearAllDebugContext(): number {
    const db = this.getDb()
    const result = db.prepare('UPDATE ai_message SET debug_context = NULL WHERE debug_context IS NOT NULL').run()
    return result.changes
  }

  // ==================== Agent 专用 ====================

  getHistoryForAgent(
    aiChatId: string,
    maxMessages?: number,
    leafMessageId?: string | null
  ): Array<{ role: 'user' | 'assistant' | 'summary'; content: string; contentBlocks?: ContentBlock[] }> {
    const messages = this.getActivePathRows(aiChatId, leafMessageId).map((row) => this.parseMessageRow(row))
    const validMessages = messages.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant' || m.role === 'summary') &&
        (m.content?.trim() || (m.role === 'assistant' && m.contentBlocks?.some((b) => b.type === 'tool')))
    )

    let summaryMsg: AIMessage | undefined
    for (let i = validMessages.length - 1; i >= 0; i--) {
      if (validMessages[i].role === 'summary') {
        summaryMsg = validMessages[i]
        break
      }
    }

    let result: Array<{ role: 'user' | 'assistant' | 'summary'; content: string; contentBlocks?: ContentBlock[] }>

    if (summaryMsg) {
      const metaBlock = summaryMsg.contentBlocks?.find(
        (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
      )
      const bufferBoundary = metaBlock?.bufferBoundaryTimestamp

      if (!metaBlock) {
        this.logger.warn('AIChats', 'summary message missing summary_meta; agent context will be summary-only', {
          aiChatId,
          messageId: summaryMsg.id,
        })
      }

      const contextMessages = bufferBoundary
        ? validMessages.filter((m) => m.role !== 'summary' && m.timestamp >= bufferBoundary)
        : []

      result = [
        { role: 'summary' as const, content: summaryMsg.content },
        ...contextMessages.map((m) => ({ role: m.role, content: m.content, contentBlocks: m.contentBlocks })),
      ]
    } else {
      result = validMessages.map((m) => ({ role: m.role, content: m.content, contentBlocks: m.contentBlocks }))
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

  addSummaryMessage(
    aiChatId: string,
    content: string,
    meta: { bufferBoundaryTimestamp: number; compressedMessageCount: number }
  ): AIMessage {
    const contentBlocks: ContentBlock[] = [
      {
        type: 'summary_meta',
        bufferBoundaryTimestamp: meta.bufferBoundaryTimestamp,
        compressedMessageCount: meta.compressedMessageCount,
      },
    ]

    return this.addMessage(aiChatId, 'summary', content, undefined, undefined, contentBlocks)
  }

  getLatestSummary(aiChatId: string): AIMessage | null {
    const row = [...this.getActivePathRows(aiChatId)].reverse().find((message) => message.role === 'summary')
    return row ? this.parseMessageRow(row) : null
  }

  getMessagesAfterSummary(
    aiChatId: string,
    summaryTimestamp: number
  ): Array<{ role: AIMessageRole; content: string; timestamp: number; contentBlocks?: ContentBlock[] }> {
    return this.getActivePathRows(aiChatId)
      .filter((row) => row.timestamp > summaryTimestamp && (row.role === 'user' || row.role === 'assistant'))
      .map((row) => this.toCompressionMessage(row))
  }

  getAllUserAssistantMessages(
    aiChatId: string
  ): Array<{ role: AIMessageRole; content: string; timestamp: number; contentBlocks?: ContentBlock[] }> {
    return this.getActivePathRows(aiChatId)
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => this.toCompressionMessage(row))
  }

  private toCompressionMessage(row: AIMessageRow): {
    role: AIMessageRole
    content: string
    timestamp: number
    contentBlocks?: ContentBlock[]
  } {
    return {
      role: row.role as AIMessageRole,
      content: row.content,
      timestamp: row.timestamp,
      contentBlocks: row.contentBlocks ? JSON.parse(row.contentBlocks) : undefined,
    }
  }

  getMessageCountAfterSummary(aiChatId: string): number {
    const summary = this.getLatestSummary(aiChatId)
    if (!summary) {
      return this.getActivePathRows(aiChatId).filter((row) => row.role === 'user' || row.role === 'assistant').length
    }

    const metaBlock = summary.contentBlocks?.find(
      (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
    )
    const boundary = metaBlock?.bufferBoundaryTimestamp ?? summary.timestamp

    return this.getActivePathRows(aiChatId).filter(
      (row) => row.timestamp >= boundary && (row.role === 'user' || row.role === 'assistant')
    ).length
  }
}
