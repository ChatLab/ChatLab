import type {
  AppendRuntimeMessageInput,
  ConversationRepository,
  RuntimeConversation,
  RuntimeContextSummary,
  RuntimeMessage,
  SaveRuntimeContextSummaryInput,
} from '@openchatlab/ai-runtime'
import type { DatabaseAdapter } from '@openchatlab/core'

import type { WorkspaceDatabasePort } from '../storage/workspace-database'

export const WEB_AI_DATABASE_FILENAME = '/chatlab-ai.db'

export const WEB_AI_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_conversation (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_conversation_session_updated
    ON ai_conversation(session_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ai_message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    blocks_json TEXT,
    usage_json TEXT,
    FOREIGN KEY(conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ai_message_conversation_created
    ON ai_message(conversation_id, created_at ASC, id ASC);

  CREATE TABLE IF NOT EXISTS ai_context_summary (
    conversation_id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    boundary_message_id TEXT NOT NULL,
    compressed_message_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
  );
`

interface ConversationRow {
  id: string
  session_id: string
  title: string | null
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  conversation_id: string
  role: RuntimeMessage['role']
  content: string
  created_at: number
  blocks_json: string | null
  usage_json: string | null
}

interface ContextSummaryRow {
  conversation_id: string
  content: string
  boundary_message_id: string
  compressed_message_count: number
  updated_at: number
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function mapConversation(row: ConversationRow): RuntimeConversation {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMessage(row: MessageRow): RuntimeMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    blocks: parseJson(row.blocks_json),
    usage: parseJson(row.usage_json),
  }
}

function mapContextSummary(row: ContextSummaryRow): RuntimeContextSummary {
  return {
    conversationId: row.conversation_id,
    content: row.content,
    boundaryMessageId: row.boundary_message_id,
    compressedMessageCount: row.compressed_message_count,
    updatedAt: row.updated_at,
  }
}

export class BrowserAIConversationRepository implements ConversationRepository {
  constructor(private readonly database: WorkspaceDatabasePort) {}

  createConversation(sessionId: string, title: string | null = null): Promise<RuntimeConversation> {
    const now = Date.now()
    const conversation: RuntimeConversation = {
      id: createId('conversation'),
      sessionId,
      title,
      createdAt: now,
      updatedAt: now,
    }
    return this.withDatabase((db) => {
      db.prepare(
        'INSERT INTO ai_conversation (id, session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(conversation.id, sessionId, title, now, now)
      return conversation
    })
  }

  async getConversation(id: string): Promise<RuntimeConversation | null> {
    return this.withDatabase((db) => {
      const row = db.prepare('SELECT * FROM ai_conversation WHERE id = ?').get(id) as ConversationRow | undefined
      return row ? mapConversation(row) : null
    })
  }

  listConversations(sessionId: string): Promise<RuntimeConversation[]> {
    return this.withDatabase((db) =>
      (
        db
          .prepare('SELECT * FROM ai_conversation WHERE session_id = ? ORDER BY updated_at DESC, id DESC')
          .all(sessionId) as unknown as ConversationRow[]
      ).map(mapConversation)
    )
  }

  renameConversation(id: string, title: string): Promise<boolean> {
    return this.withDatabase(
      (db) =>
        db.prepare('UPDATE ai_conversation SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
          .changes > 0
    )
  }

  deleteConversation(id: string): Promise<boolean> {
    return this.withDatabase((db) => db.prepare('DELETE FROM ai_conversation WHERE id = ?').run(id).changes > 0)
  }

  deleteBySession(sessionId: string): Promise<number> {
    return this.withDatabase(
      (db) => db.prepare('DELETE FROM ai_conversation WHERE session_id = ?').run(sessionId).changes
    )
  }

  getMessages(conversationId: string): Promise<RuntimeMessage[]> {
    return this.withDatabase((db) =>
      (
        db
          .prepare(
            `SELECT * FROM ai_message
             WHERE conversation_id = ? AND role IN ('user', 'assistant')
             ORDER BY created_at ASC, id ASC`
          )
          .all(conversationId) as unknown as MessageRow[]
      ).map(mapMessage)
    )
  }

  getContextSummary(conversationId: string): Promise<RuntimeContextSummary | null> {
    return this.withDatabase((db) => {
      const row = db.prepare('SELECT * FROM ai_context_summary WHERE conversation_id = ?').get(conversationId) as
        | ContextSummaryRow
        | undefined
      return row ? mapContextSummary(row) : null
    })
  }

  saveContextSummary(input: SaveRuntimeContextSummaryInput): Promise<RuntimeContextSummary> {
    const summary: RuntimeContextSummary = { ...input, updatedAt: Date.now() }
    return this.withDatabase((db) => {
      db.prepare(
        `INSERT INTO ai_context_summary (
           conversation_id, content, boundary_message_id, compressed_message_count, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           content = excluded.content,
           boundary_message_id = excluded.boundary_message_id,
           compressed_message_count = excluded.compressed_message_count,
           updated_at = excluded.updated_at`
      ).run(
        summary.conversationId,
        summary.content,
        summary.boundaryMessageId,
        summary.compressedMessageCount,
        summary.updatedAt
      )
      return summary
    })
  }

  appendMessage(input: AppendRuntimeMessageInput): Promise<RuntimeMessage> {
    const message: RuntimeMessage = {
      id: input.id ?? createId('message'),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAt: input.createdAt ?? Date.now(),
      blocks: input.blocks,
      usage: input.usage,
    }
    return this.withDatabase((db) => {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO ai_message (
             id, conversation_id, role, content, created_at, blocks_json, usage_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          message.id,
          message.conversationId,
          message.role,
          message.content,
          message.createdAt,
          message.blocks ? JSON.stringify(message.blocks) : null,
          message.usage ? JSON.stringify(message.usage) : null
        )
        db.prepare('UPDATE ai_conversation SET updated_at = ? WHERE id = ?').run(Date.now(), message.conversationId)
      })
      return message
    })
  }

  updateMessage(id: string, patch: Pick<RuntimeMessage, 'content' | 'blocks' | 'usage'>): Promise<void> {
    return this.withDatabase((db) => {
      db.prepare('UPDATE ai_message SET content = ?, blocks_json = ?, usage_json = ? WHERE id = ?').run(
        patch.content,
        patch.blocks ? JSON.stringify(patch.blocks) : null,
        patch.usage ? JSON.stringify(patch.usage) : null,
        id
      )
    })
  }

  deleteMessage(id: string): Promise<boolean> {
    return this.withDatabase((db) => db.prepare('DELETE FROM ai_message WHERE id = ?').run(id).changes > 0)
  }

  private withDatabase<T>(operation: (db: DatabaseAdapter) => T): Promise<T> {
    return this.database.withDatabase(WEB_AI_DATABASE_FILENAME, WEB_AI_SCHEMA, operation)
  }
}
