import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import type {
  AIEntityRef,
  AIMemoryEntry,
  AIMemoryScope,
  AIMemoryScopeType,
  AIMemorySourceType,
} from '@openchatlab/shared-types'
import { appLogger } from '../logging/app-logger'

export const AI_MEMORY_CONTENT_MAX_CHARS = 2_000
const AI_MEMORY_SCHEMA_VERSION = 1
const AI_MEMORY_PROMPT_MAX_ENTRIES = 20
const AI_MEMORY_PROMPT_MAX_CONTENT_CHARS = 4_000

export function buildGlobalMemoryPrompt(entries: AIMemoryEntry[], locale = 'zh-CN'): string {
  const selected: AIMemoryEntry[] = []
  let contentChars = 0
  for (const entry of entries) {
    if (
      selected.length >= AI_MEMORY_PROMPT_MAX_ENTRIES ||
      contentChars + entry.content.length > AI_MEMORY_PROMPT_MAX_CONTENT_CHARS
    ) {
      break
    }
    selected.push(entry)
    contentChars += entry.content.length
  }
  if (selected.length === 0) return ''

  const lines = selected.map((entry) => `- [id=${entry.id}; source=${entry.sourceType}] ${entry.content}`)
  if (selected.length < entries.length) {
    lines.push(
      locale.startsWith('zh')
        ? '- 部分全局记忆未注入；需要时调用 memory_read 读取。'
        : '- Some global memories were not injected; call memory_read when needed.'
    )
  }
  return lines.join('\n')
}

interface EntityMemoryBucket {
  scope: AIMemoryScope
  displayName: string
  entries: AIMemoryEntry[]
}

interface SelectedEntityMemory {
  bucket: EntityMemoryBucket
  entry: AIMemoryEntry
}

export function buildEntityMemoryPrompt(
  entityRefs: AIEntityRef[] | undefined,
  loadEntries: (scope: AIMemoryScope) => AIMemoryEntry[],
  locale = 'zh-CN'
): string {
  const buckets: EntityMemoryBucket[] = []
  const seenScopes = new Set<string>()

  for (const ref of entityRefs ?? []) {
    const scope: AIMemoryScope | null =
      ref.type === 'contact'
        ? { scopeType: 'contact', scopeId: ref.contactKey }
        : ref.sessionType === 'group'
          ? { scopeType: 'group', scopeId: ref.sessionId }
          : null
    if (!scope?.scopeId) continue

    const scopeKey = `${scope.scopeType}:${scope.scopeId}`
    if (seenScopes.has(scopeKey)) continue
    seenScopes.add(scopeKey)
    buckets.push({
      scope,
      displayName: ref.displayName,
      entries: loadEntries(scope),
    })
  }

  const candidates: SelectedEntityMemory[] = []
  const maxBucketSize = Math.max(0, ...buckets.map((bucket) => bucket.entries.length))
  for (let index = 0; index < maxBucketSize; index++) {
    for (const bucket of buckets) {
      const entry = bucket.entries[index]
      if (entry) candidates.push({ bucket, entry })
    }
  }

  const selected: SelectedEntityMemory[] = []
  let contentChars = 0
  for (const candidate of candidates) {
    if (selected.length >= AI_MEMORY_PROMPT_MAX_ENTRIES) break
    if (contentChars + candidate.entry.content.length > AI_MEMORY_PROMPT_MAX_CONTENT_CHARS) continue
    selected.push(candidate)
    contentChars += candidate.entry.content.length
  }
  if (selected.length === 0) return ''

  const lines = selected.map(({ bucket, entry }) => {
    return `- [scope=${bucket.scope.scopeType}; scope_id=${JSON.stringify(bucket.scope.scopeId)}; display_name=${JSON.stringify(bucket.displayName)}; id=${entry.id}; source=${entry.sourceType}] ${entry.content}`
  })
  if (selected.length < candidates.length) {
    lines.push(
      locale.startsWith('zh')
        ? '- 部分当前实体记忆未注入；需要时调用 memory_read 读取。'
        : '- Some memories for the current entities were not injected; call memory_read when needed.'
    )
  }
  return lines.join('\n')
}

export interface CreateAIMemoryInput extends AIMemoryScope {
  content: string
  sourceType: AIMemorySourceType
  sourceAIChatId?: string | null
  sourceMessageId?: string | null
}

export interface UpdateAIMemoryInput {
  content: string
  sourceType: AIMemorySourceType
  sourceAIChatId?: string | null
  sourceMessageId?: string | null
}

interface AIMemoryRow {
  id: string
  scopeType: AIMemoryScopeType
  scopeId: string | null
  content: string
  sourceType: AIMemorySourceType
  sourceAIChatId: string | null
  sourceMessageId: string | null
  createdAt: number
  updatedAt: number
}

export interface AIMemoryServiceOptions {
  nativeBinding?: string
  now?: () => number
  idFactory?: () => string
}

export class AIMemoryService {
  private db: Database.Database | null = null
  private readonly dbPath: string
  private readonly nativeBinding?: string
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(aiDataDir: string, options: AIMemoryServiceOptions = {}) {
    this.dbPath = path.join(aiDataDir, 'memory.db')
    this.nativeBinding = options.nativeBinding
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? (() => `memory_${randomUUID()}`)
  }

  list(scope?: AIMemoryScope): AIMemoryEntry[] {
    const db = this.getDb()
    if (!scope) {
      return db
        .prepare(
          `SELECT id,
                  scope_type AS scopeType,
                  scope_id AS scopeId,
                  content,
                  source_type AS sourceType,
                  source_ai_chat_id AS sourceAIChatId,
                  source_message_id AS sourceMessageId,
                  created_at AS createdAt,
                  updated_at AS updatedAt
             FROM ai_memory
            ORDER BY updated_at DESC, id ASC`
        )
        .all() as AIMemoryEntry[]
    }

    const normalized = normalizeScope(scope)
    if (normalized.scopeType === 'global') {
      return db
        .prepare(
          `SELECT id,
                  scope_type AS scopeType,
                  scope_id AS scopeId,
                  content,
                  source_type AS sourceType,
                  source_ai_chat_id AS sourceAIChatId,
                  source_message_id AS sourceMessageId,
                  created_at AS createdAt,
                  updated_at AS updatedAt
             FROM ai_memory
            WHERE scope_type = 'global' AND scope_id IS NULL
            ORDER BY updated_at DESC, id ASC`
        )
        .all() as AIMemoryEntry[]
    }

    return db
      .prepare(
        `SELECT id,
                scope_type AS scopeType,
                scope_id AS scopeId,
                content,
                source_type AS sourceType,
                source_ai_chat_id AS sourceAIChatId,
                source_message_id AS sourceMessageId,
                created_at AS createdAt,
                updated_at AS updatedAt
           FROM ai_memory
          WHERE scope_type = ? AND scope_id = ?
          ORDER BY updated_at DESC, id ASC`
      )
      .all(normalized.scopeType, normalized.scopeId) as AIMemoryEntry[]
  }

  get(id: string): AIMemoryEntry | null {
    const row = this.getDb()
      .prepare(
        `SELECT id,
                scope_type AS scopeType,
                scope_id AS scopeId,
                content,
                source_type AS sourceType,
                source_ai_chat_id AS sourceAIChatId,
                source_message_id AS sourceMessageId,
                created_at AS createdAt,
                updated_at AS updatedAt
           FROM ai_memory
          WHERE id = ?`
      )
      .get(id) as AIMemoryRow | undefined
    return row ?? null
  }

  create(input: CreateAIMemoryInput): AIMemoryEntry {
    return this.runWrite('create', () => {
      const scope = normalizeScope(input)
      const content = normalizeContent(input.content)
      const sourceType = normalizeSourceType(input.sourceType)
      const id = this.idFactory()
      const now = this.now()

      this.getDb()
        .prepare(
          `INSERT INTO ai_memory (
            id, scope_type, scope_id, content, source_type,
            source_ai_chat_id, source_message_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          scope.scopeType,
          scope.scopeId,
          content,
          sourceType,
          normalizeOptionalId(input.sourceAIChatId),
          normalizeOptionalId(input.sourceMessageId),
          now,
          now
        )

      return this.requireEntry(id)
    })
  }

  update(id: string, input: UpdateAIMemoryInput): AIMemoryEntry {
    return this.runWrite('update', () => {
      const content = normalizeContent(input.content)
      const sourceType = normalizeSourceType(input.sourceType)
      const result = this.getDb()
        .prepare(
          `UPDATE ai_memory
              SET content = ?,
                  source_type = ?,
                  source_ai_chat_id = ?,
                  source_message_id = ?,
                  updated_at = ?
            WHERE id = ?`
        )
        .run(
          content,
          sourceType,
          normalizeOptionalId(input.sourceAIChatId),
          normalizeOptionalId(input.sourceMessageId),
          this.now(),
          id
        )

      if (result.changes === 0) throw new Error(`AI memory not found: ${id}`)
      return this.requireEntry(id)
    })
  }

  forget(id: string): boolean {
    return this.runWrite('forget', () => this.getDb().prepare('DELETE FROM ai_memory WHERE id = ?').run(id).changes > 0)
  }

  clear(scope?: AIMemoryScope): number {
    return this.runWrite('clear', () => {
      const db = this.getDb()
      if (!scope) return db.prepare('DELETE FROM ai_memory').run().changes

      const normalized = normalizeScope(scope)
      if (normalized.scopeType === 'global') {
        return db.prepare("DELETE FROM ai_memory WHERE scope_type = 'global' AND scope_id IS NULL").run().changes
      }
      return db
        .prepare('DELETE FROM ai_memory WHERE scope_type = ? AND scope_id = ?')
        .run(normalized.scopeType, normalized.scopeId).changes
    })
  }

  getSchemaVersion(): number {
    return this.getDb().pragma('user_version', { simple: true }) as number
  }

  close(): void {
    if (!this.db) return
    this.db.close()
    this.db = null
    appLogger.debug('ai-memory', 'AI memory database closed')
  }

  private getDb(): Database.Database {
    if (this.db) return this.db

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    const db = this.nativeBinding
      ? new Database(this.dbPath, { nativeBinding: this.nativeBinding })
      : new Database(this.dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_memory (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'contact', 'group')),
        scope_id TEXT,
        content TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('user', 'ai')),
        source_ai_chat_id TEXT,
        source_message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (
          (scope_type = 'global' AND scope_id IS NULL) OR
          (scope_type IN ('contact', 'group') AND scope_id IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_ai_memory_scope_updated
        ON ai_memory(scope_type, scope_id, updated_at DESC, id ASC);
    `)
    db.pragma(`user_version = ${AI_MEMORY_SCHEMA_VERSION}`)
    this.db = db
    appLogger.info('ai-memory', 'AI memory database initialized', { schemaVersion: AI_MEMORY_SCHEMA_VERSION })
    return db
  }

  private requireEntry(id: string): AIMemoryEntry {
    const entry = this.get(id)
    if (!entry) throw new Error(`AI memory not found after write: ${id}`)
    return entry
  }

  private runWrite<T>(operation: string, write: () => T): T {
    try {
      return write()
    } catch (error) {
      appLogger.error('ai-memory', `AI memory ${operation} failed`, error)
      throw error
    }
  }
}

function normalizeScope(scope: AIMemoryScope): AIMemoryScope {
  const scopeType = scope.scopeType
  if (scopeType !== 'global' && scopeType !== 'contact' && scopeType !== 'group') {
    throw new Error(`Unsupported AI memory scope type: ${String(scopeType)}`)
  }

  const scopeId = normalizeOptionalId(scope.scopeId)
  if (scopeType === 'global') {
    if (scopeId !== null) throw new Error('Global AI memory scopeId must be null')
    return { scopeType, scopeId: null }
  }
  if (!scopeId) throw new Error(`${scopeType} AI memory scopeId is required`)
  return { scopeType, scopeId }
}

function normalizeSourceType(sourceType: AIMemorySourceType): AIMemorySourceType {
  if (sourceType !== 'user' && sourceType !== 'ai') {
    throw new Error(`Unsupported AI memory source type: ${String(sourceType)}`)
  }
  return sourceType
}

function normalizeContent(content: string): string {
  const normalized = typeof content === 'string' ? content.trim() : ''
  if (!normalized || normalized.length > AI_MEMORY_CONTENT_MAX_CHARS) {
    throw new Error(`AI memory content must be between 1 and ${AI_MEMORY_CONTENT_MAX_CHARS} characters`)
  }
  return normalized
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}
