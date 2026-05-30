/**
 * AI 对话历史管理模块（平台无关）
 *
 * 管理 AI 对话的持久化存储（conversations.db），
 * 供 Electron 主进程和 CLI serve 共用。
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

const DEFAULT_GENERAL_ID = 'general_cn'

// ==================== 类型定义 ====================

export interface AIConversation {
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
  parentId?: string | null
  dataKeywords?: string[]
  dataMessageCount?: number
  contentBlocks?: ContentBlock[]
  tokenUsage?: TokenUsageData
}

interface AIMessageRow {
  id: string
  conversationId: string
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

export interface ConversationManagerLogger {
  warn(category: string, message: string, extra?: Record<string, unknown>): void
}

const defaultLogger: ConversationManagerLogger = {
  warn(_category, message, extra) {
    console.warn(`[AI Conversations] ${message}`, extra ?? '')
  },
}

// ==================== AIConversationManager ====================

export class AIConversationManager {
  private db: Database.Database | null = null
  private readonly aiDataDir: string
  private readonly logger: ConversationManagerLogger
  private readonly nativeBinding?: string
  private readonly pendingDebugContextMap = new Map<string, string>()

  constructor(aiDataDir: string, options?: { logger?: ConversationManagerLogger; nativeBinding?: string }) {
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
      CREATE TABLE IF NOT EXISTS ai_conversation (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT,
        active_message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_message (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data_keywords TEXT,
        data_message_count INTEGER,
        content_blocks TEXT,
        parent_id TEXT,
        sibling_group_id TEXT,
        branch_index INTEGER DEFAULT 0,
        FOREIGN KEY(conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_conversation_session ON ai_conversation(session_id);
      CREATE INDEX IF NOT EXISTS idx_ai_message_conversation ON ai_message(conversation_id);
    `)

    this.migrateDatabase(this.db)
    return this.db
  }

  private migrateDatabase(db: Database.Database): void {
    try {
      const messageTableInfo = db.pragma('table_info(ai_message)') as Array<{ name: string }>
      const messageColumns = messageTableInfo.map((col) => col.name)

      const needsMessageTreeBackfill =
        !messageColumns.includes('parent_id') ||
        !messageColumns.includes('sibling_group_id') ||
        !messageColumns.includes('branch_index')

      if (!messageColumns.includes('content_blocks')) {
        db.exec('ALTER TABLE ai_message ADD COLUMN content_blocks TEXT')
      }
      if (!messageColumns.includes('token_usage')) {
        db.exec('ALTER TABLE ai_message ADD COLUMN token_usage TEXT')
      }
      if (!messageColumns.includes('debug_context')) {
        db.exec('ALTER TABLE ai_message ADD COLUMN debug_context TEXT')
      }
      if (!messageColumns.includes('parent_id')) {
        db.exec('ALTER TABLE ai_message ADD COLUMN parent_id TEXT')
      }
      if (!messageColumns.includes('sibling_group_id')) {
        db.exec('ALTER TABLE ai_message ADD COLUMN sibling_group_id TEXT')
      }
      if (!messageColumns.includes('branch_index')) {
        db.exec('ALTER TABLE ai_message ADD COLUMN branch_index INTEGER DEFAULT 0')
      }

      const convTableInfo = db.pragma('table_info(ai_conversation)') as Array<{ name: string }>
      const convColumns = convTableInfo.map((col) => col.name)
      const needsConversationBackfill = !convColumns.includes('active_message_id')

      if (!convColumns.includes('assistant_id')) {
        db.exec(`ALTER TABLE ai_conversation ADD COLUMN assistant_id TEXT DEFAULT '${DEFAULT_GENERAL_ID}'`)
      }
      if (!convColumns.includes('active_message_id')) {
        db.exec('ALTER TABLE ai_conversation ADD COLUMN active_message_id TEXT')
      }

      if (needsMessageTreeBackfill || needsConversationBackfill || this.hasUnbackfilledMessageTree(db)) {
        this.backfillMessageTree(db)
      }

      db.exec(`
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
         FROM ai_conversation c
         WHERE EXISTS (
           SELECT 1 FROM ai_message m
           WHERE m.conversation_id = c.id
         )
         AND (
           c.active_message_id IS NULL
           OR EXISTS (
             SELECT 1 FROM ai_message m
             WHERE m.conversation_id = c.id
               AND (m.sibling_group_id IS NULL OR m.branch_index IS NULL)
           )
         )
         LIMIT 1`
      )
      .get()
    return !!row
  }

  private backfillMessageTree(db: Database.Database): void {
    const conversations = db.prepare('SELECT id FROM ai_conversation').all() as Array<{ id: string }>
    const updateMessage = db.prepare(
      'UPDATE ai_message SET parent_id = ?, sibling_group_id = COALESCE(sibling_group_id, ?), branch_index = COALESCE(branch_index, 0) WHERE id = ?'
    )
    const updateConversation = db.prepare('UPDATE ai_conversation SET active_message_id = ? WHERE id = ?')

    const tx = db.transaction(() => {
      for (const conversation of conversations) {
        const messages = db
          .prepare(
            `SELECT id, parent_id as parentId, sibling_group_id as siblingGroupId
             FROM ai_message WHERE conversation_id = ? ORDER BY timestamp ASC, id ASC`
          )
          .all(conversation.id) as Array<{ id: string; parentId: string | null; siblingGroupId: string | null }>

        let previousId: string | null = null
        for (const message of messages) {
          const parentId = message.parentId === undefined ? previousId : (message.parentId ?? previousId)
          updateMessage.run(parentId, message.siblingGroupId ?? message.id, message.id)
          previousId = message.id
        }

        const conversationRow = db
          .prepare('SELECT active_message_id as activeMessageId FROM ai_conversation WHERE id = ?')
          .get(conversation.id) as { activeMessageId: string | null } | undefined
        if (!conversationRow?.activeMessageId && previousId) {
          updateConversation.run(previousId, conversation.id)
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
      conversationId: row.conversationId,
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
        `SELECT id, conversation_id as conversationId, role, content, timestamp,
                parent_id as parentId, sibling_group_id as siblingGroupId, branch_index as branchIndex,
                data_keywords as dataKeywords, data_message_count as dataMessageCount,
                content_blocks as contentBlocks, token_usage as tokenUsage
         FROM ai_message WHERE id = ?`
      )
      .get(messageId) as AIMessageRow | undefined
    return row ?? null
  }

  private getActiveMessageId(conversationId: string): string | null {
    const db = this.getDb()
    const row = db
      .prepare('SELECT active_message_id as activeMessageId FROM ai_conversation WHERE id = ?')
      .get(conversationId) as { activeMessageId: string | null } | undefined
    if (row?.activeMessageId) {
      const activeExists = db.prepare('SELECT 1 FROM ai_message WHERE id = ?').get(row.activeMessageId)
      if (activeExists) return row.activeMessageId
    }

    const fallback = db
      .prepare('SELECT id FROM ai_message WHERE conversation_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1')
      .get(conversationId) as { id: string } | undefined
    if (fallback?.id) {
      db.prepare('UPDATE ai_conversation SET active_message_id = ? WHERE id = ?').run(fallback.id, conversationId)
      return fallback.id
    }
    return null
  }

  private getAllMessageRows(conversationId: string): AIMessageRow[] {
    return this.getDb()
      .prepare(
        `SELECT id, conversation_id as conversationId, role, content, timestamp,
                parent_id as parentId, sibling_group_id as siblingGroupId, branch_index as branchIndex,
                data_keywords as dataKeywords, data_message_count as dataMessageCount,
                content_blocks as contentBlocks, token_usage as tokenUsage
         FROM ai_message WHERE conversation_id = ? ORDER BY timestamp ASC, id ASC`
      )
      .all(conversationId) as AIMessageRow[]
  }

  private getActivePathRows(conversationId: string, leafMessageId?: string | null): AIMessageRow[] {
    if (leafMessageId === null) return []

    const allRows = this.getAllMessageRows(conversationId)
    if (allRows.length === 0) return []

    const rowMap = new Map(allRows.map((row) => [row.id, row]))
    let currentId = leafMessageId ?? this.getActiveMessageId(conversationId)
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

  createConversation(sessionId: string, title: string | undefined, assistantId: string): AIConversation {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId('conv')

    db.prepare(
      `INSERT INTO ai_conversation (id, session_id, title, assistant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, title || null, assistantId, now, now)

    return { id, sessionId, title: title || null, assistantId, activeMessageId: null, createdAt: now, updatedAt: now }
  }

  getConversationCountsBySession(): Map<string, number> {
    const result = new Map<string, number>()
    try {
      const db = this.getDb()
      const rows = db
        .prepare('SELECT session_id, COUNT(*) as count FROM ai_conversation GROUP BY session_id')
        .all() as Array<{ session_id: string; count: number }>
      for (const row of rows) {
        result.set(row.session_id, row.count)
      }
    } catch {
      // AI DB may not be initialized yet
    }
    return result
  }

  getConversations(sessionId: string): AIConversation[] {
    const db = this.getDb()
    return db
      .prepare(
        `SELECT id, session_id as sessionId, title, assistant_id as assistantId,
                active_message_id as activeMessageId,
                created_at as createdAt, updated_at as updatedAt
         FROM ai_conversation WHERE session_id = ? ORDER BY updated_at DESC`
      )
      .all(sessionId) as AIConversation[]
  }

  getConversation(conversationId: string): AIConversation | null {
    const db = this.getDb()
    const row = db
      .prepare(
        `SELECT id, session_id as sessionId, title, assistant_id as assistantId,
                active_message_id as activeMessageId,
                created_at as createdAt, updated_at as updatedAt
         FROM ai_conversation WHERE id = ?`
      )
      .get(conversationId) as AIConversation | undefined
    return row || null
  }

  updateConversationTitle(conversationId: string, title: string): boolean {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const result = db
      .prepare('UPDATE ai_conversation SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, conversationId)
    return result.changes > 0
  }

  deleteConversation(conversationId: string): boolean {
    const db = this.getDb()
    db.prepare('DELETE FROM ai_message WHERE conversation_id = ?').run(conversationId)
    const result = db.prepare('DELETE FROM ai_conversation WHERE id = ?').run(conversationId)
    return result.changes > 0
  }

  // ==================== 消息管理 ====================

  addMessage(
    conversationId: string,
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
    const parentId = this.getActiveMessageId(conversationId)
    const siblingGroupId = id
    const branchIndex = 0

    const pendingDebug = role === 'assistant' ? this.pendingDebugContextMap.get(conversationId) : undefined
    if (pendingDebug) {
      this.pendingDebugContextMap.delete(conversationId)
    }

    db.prepare(
      `INSERT INTO ai_message (
         id, conversation_id, role, content, timestamp, data_keywords, data_message_count,
         content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      pendingDebug ?? null,
      parentId,
      siblingGroupId,
      branchIndex
    )

    db.prepare('UPDATE ai_conversation SET active_message_id = ?, updated_at = ? WHERE id = ?').run(
      id,
      now,
      conversationId
    )

    return {
      id,
      conversationId,
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

  getMessages(conversationId: string): AIMessage[] {
    return this.getActivePathRows(conversationId).map((row) => this.parseMessageRow(row))
  }

  deleteMessage(messageId: string): boolean {
    const db = this.getDb()
    const result = db.prepare('DELETE FROM ai_message WHERE id = ?').run(messageId)
    return result.changes > 0
  }

  deleteMessagesFrom(conversationId: string, messageId: string): void {
    const db = this.getDb()
    const target = this.getMessageRow(messageId)
    if (!target || target.conversationId !== conversationId) {
      throw new Error('Message not found in conversation')
    }

    const activePath = this.getActivePathRows(conversationId)
    const targetIndex = activePath.findIndex((row) => row.id === messageId)
    if (targetIndex < 0) {
      throw new Error('Message not on active path')
    }

    const idsToDelete = activePath.slice(targetIndex).map((row) => row.id)
    const placeholders = idsToDelete.map(() => '?').join(', ')
    db.prepare(`DELETE FROM ai_message WHERE id IN (${placeholders})`).run(...idsToDelete)

    const newLeafId = targetIndex > 0 ? activePath[targetIndex - 1]!.id : null
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE ai_conversation SET active_message_id = ?, updated_at = ? WHERE id = ?').run(
      newLeafId,
      now,
      conversationId
    )
  }

  forkConversation(sourceConversationId: string, upToMessageId: string, title?: string): AIConversation {
    const db = this.getDb()
    const source = this.getConversation(sourceConversationId)
    if (!source) {
      throw new Error('Source conversation not found')
    }

    const activePath = this.getActivePathRows(sourceConversationId)
    const cutIndex = activePath.findIndex((row) => row.id === upToMessageId)
    if (cutIndex < 0) {
      throw new Error('Message not on active path')
    }

    const messagesToCopy = activePath.slice(0, cutIndex)
    const now = Math.floor(Date.now() / 1000)
    const newConvId = this.generateId('conv')
    const forkTitle = title || `${source.title || 'Untitled'} (fork)`

    db.prepare(
      `INSERT INTO ai_conversation (id, session_id, title, assistant_id, active_message_id, created_at, updated_at)
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
           id, conversation_id, role, content, timestamp, data_keywords, data_message_count,
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
      db.prepare('UPDATE ai_conversation SET active_message_id = ? WHERE id = ?').run(lastNewId, newConvId)
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

  deleteAndRelinkMessage(conversationId: string, messageId: string): void {
    const db = this.getDb()
    const target = this.getMessageRow(messageId)
    if (!target || target.conversationId !== conversationId) {
      throw new Error('Message not found in conversation')
    }

    db.prepare('UPDATE ai_message SET parent_id = ? WHERE parent_id = ? AND conversation_id = ?').run(
      target.parentId,
      messageId,
      conversationId
    )

    const conv = this.getConversation(conversationId)
    if (conv?.activeMessageId === messageId) {
      const now = Math.floor(Date.now() / 1000)
      db.prepare('UPDATE ai_conversation SET active_message_id = ?, updated_at = ? WHERE id = ?').run(
        target.parentId,
        now,
        conversationId
      )
    }

    db.prepare('DELETE FROM ai_message WHERE id = ?').run(messageId)
  }

  insertMessageAfter(
    conversationId: string,
    afterMessageId: string,
    role: AIMessageRole,
    content: string,
    contentBlocks?: ContentBlock[],
    tokenUsage?: TokenUsageData
  ): AIMessage {
    const db = this.getDb()
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId('msg')

    const pendingDebug = role === 'assistant' ? this.pendingDebugContextMap.get(conversationId) : undefined
    if (pendingDebug) {
      this.pendingDebugContextMap.delete(conversationId)
    }

    const childRow = db
      .prepare('SELECT id FROM ai_message WHERE parent_id = ? AND conversation_id = ? LIMIT 1')
      .get(afterMessageId, conversationId) as { id: string } | undefined

    db.prepare(
      `INSERT INTO ai_message (
         id, conversation_id, role, content, timestamp, data_keywords, data_message_count,
         content_blocks, token_usage, debug_context, parent_id, sibling_group_id, branch_index
       )
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      conversationId,
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
    }

    db.prepare('UPDATE ai_conversation SET updated_at = ? WHERE id = ?').run(now, conversationId)

    return {
      id,
      conversationId,
      role,
      content,
      timestamp: now,
      parentId: afterMessageId,
      contentBlocks,
      tokenUsage,
    }
  }

  getConversationTokenUsage(conversationId: string): TokenUsageData {
    const rows = this.getActivePathRows(conversationId)
    const result: TokenUsageData = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    for (const row of rows) {
      if (row.tokenUsage) {
        const usage = JSON.parse(row.tokenUsage) as TokenUsageData
        result.promptTokens += usage.promptTokens
        result.completionTokens += usage.completionTokens
        result.totalTokens += usage.totalTokens
      }
    }
    return result
  }

  // ==================== Debug context ====================

  setPendingDebugContext(conversationId: string, debugContext: string): void {
    this.pendingDebugContextMap.set(conversationId, debugContext)
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
    conversationId: string,
    maxMessages?: number,
    leafMessageId?: string | null
  ): Array<{ role: 'user' | 'assistant' | 'summary'; content: string }> {
    const messages = this.getActivePathRows(conversationId, leafMessageId).map((row) => this.parseMessageRow(row))
    const validMessages = messages.filter(
      (m) => (m.role === 'user' || m.role === 'assistant' || m.role === 'summary') && m.content?.trim()
    )

    let summaryMsg: AIMessage | undefined
    for (let i = validMessages.length - 1; i >= 0; i--) {
      if (validMessages[i].role === 'summary') {
        summaryMsg = validMessages[i]
        break
      }
    }

    let result: Array<{ role: 'user' | 'assistant' | 'summary'; content: string }>

    if (summaryMsg) {
      const metaBlock = summaryMsg.contentBlocks?.find(
        (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
      )
      const bufferBoundary = metaBlock?.bufferBoundaryTimestamp

      if (!metaBlock) {
        this.logger.warn('Conversations', 'summary message missing summary_meta; agent context will be summary-only', {
          conversationId,
          messageId: summaryMsg.id,
        })
      }

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

  addSummaryMessage(
    conversationId: string,
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

    return this.addMessage(conversationId, 'summary', content, undefined, undefined, contentBlocks)
  }

  getLatestSummary(conversationId: string): AIMessage | null {
    const row = [...this.getActivePathRows(conversationId)].reverse().find((message) => message.role === 'summary')
    return row ? this.parseMessageRow(row) : null
  }

  getMessagesAfterSummary(
    conversationId: string,
    summaryTimestamp: number
  ): Array<{ role: AIMessageRole; content: string; timestamp: number }> {
    return this.getActivePathRows(conversationId)
      .filter((row) => row.timestamp > summaryTimestamp && (row.role === 'user' || row.role === 'assistant'))
      .map((row) => ({ role: row.role as AIMessageRole, content: row.content, timestamp: row.timestamp }))
  }

  getAllUserAssistantMessages(
    conversationId: string
  ): Array<{ role: AIMessageRole; content: string; timestamp: number }> {
    return this.getActivePathRows(conversationId)
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({ role: row.role as AIMessageRole, content: row.content, timestamp: row.timestamp }))
  }

  getMessageCountAfterSummary(conversationId: string): number {
    const summary = this.getLatestSummary(conversationId)
    if (!summary) {
      return this.getActivePathRows(conversationId).filter((row) => row.role === 'user' || row.role === 'assistant')
        .length
    }

    const metaBlock = summary.contentBlocks?.find(
      (b): b is Extract<ContentBlock, { type: 'summary_meta' }> => b.type === 'summary_meta'
    )
    const boundary = metaBlock?.bufferBoundaryTimestamp ?? summary.timestamp

    return this.getActivePathRows(conversationId).filter(
      (row) => row.timestamp >= boundary && (row.role === 'user' || row.role === 'assistant')
    ).length
  }
}
