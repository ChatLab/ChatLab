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
import type { SupportedLocale } from '@openchatlab/core'
import { appLogger } from '../logging/app-logger'
import { segment } from '../nlp/segmenter'

export const AI_MEMORY_CONTENT_MAX_CHARS = 2_000
const AI_MEMORY_SCHEMA_VERSION = 2
const AI_MEMORY_PROMPT_MAX_ENTRIES = 20
const AI_MEMORY_PROMPT_MAX_CONTENT_CHARS = 4_000
const AI_MEMORY_PROMPT_BASE_USER_ENTRIES = 5
const AI_MEMORY_SUBSTRING_MIN_CHARS = 3
const NUMERIC_MEMORY_TOKEN_REGEX = /\p{Number}+/gu
const SYMBOL_SUFFIX_MEMORY_TOKEN_REGEX = /[\p{Letter}\p{Number}]+(?:\+\+|#)/gu

export type AIMemoryRetrievalMode = 'relevance' | 'recent_fallback'

export interface AIMemorySearchResult {
  entries: AIMemoryEntry[]
  retrievalMode: AIMemoryRetrievalMode
  matchedCount: number
}

interface RankMemoryEntriesOptions {
  query: string
  locale?: string
}

interface ScoredMemoryEntry {
  entry: AIMemoryEntry
  score: number
}

export function rankMemoryEntries(entries: AIMemoryEntry[], options: RankMemoryEntriesOptions): AIMemorySearchResult {
  const recentEntries = [...entries].sort(compareRecentMemoryEntries)
  const query = normalizeSearchText(options.query)
  if (!query) {
    return { entries: recentEntries, retrievalMode: 'recent_fallback', matchedCount: 0 }
  }

  const locale = normalizeMemoryLocale(options.locale)
  const queryTokens = tokenizeMemoryText(options.query, locale)
  const scored: ScoredMemoryEntry[] = recentEntries.map((entry) => ({
    entry,
    score: scoreMemoryEntry(entry.content, query, queryTokens, locale),
  }))
  const matchedCount = scored.filter((item) => item.score > 0).length
  if (matchedCount === 0) {
    return { entries: recentEntries, retrievalMode: 'recent_fallback', matchedCount: 0 }
  }

  scored.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score
    if (left.entry.sourceType !== right.entry.sourceType) return left.entry.sourceType === 'user' ? -1 : 1
    return compareRecentMemoryEntries(left.entry, right.entry)
  })
  return {
    entries: scored.map((item) => item.entry),
    retrievalMode: 'relevance',
    matchedCount,
  }
}

export function buildGlobalMemoryPrompt(entries: AIMemoryEntry[], locale = 'zh-CN', query = ''): string {
  const ranking = rankMemoryEntries(entries, { query, locale })
  const rankedEntries = ranking.entries
  const recentUserEntries = [...entries]
    .filter((entry) => entry.sourceType === 'user')
    .sort(compareRecentMemoryEntries)
    .slice(0, AI_MEMORY_PROMPT_BASE_USER_ENTRIES)
  const prioritizedEntries: AIMemoryEntry[] = []
  const prioritizedIds = new Set<string>()
  const topRelevantEntries = ranking.retrievalMode === 'relevance' ? rankedEntries.slice(0, 1) : []
  for (const entry of [...topRelevantEntries, ...recentUserEntries, ...rankedEntries]) {
    if (prioritizedIds.has(entry.id)) continue
    prioritizedIds.add(entry.id)
    prioritizedEntries.push(entry)
  }
  const selected: AIMemoryEntry[] = []
  let contentChars = 0
  for (const entry of prioritizedEntries) {
    if (selected.length >= AI_MEMORY_PROMPT_MAX_ENTRIES) break
    if (contentChars + entry.content.length > AI_MEMORY_PROMPT_MAX_CONTENT_CHARS) continue
    selected.push(entry)
    contentChars += entry.content.length
  }
  if (selected.length === 0) return ''

  const lines = selected.map((entry) => `- [id=${entry.id}; source=${entry.sourceType}] ${entry.content}`)
  if (selected.length < prioritizedEntries.length) {
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
  locale = 'zh-CN',
  query = ''
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
      entries: rankMemoryEntries(loadEntries(scope), { query, locale }).entries,
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
    if (normalized.scopeType === 'global' || normalized.scopeType === 'self') {
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
            WHERE scope_type = ? AND scope_id IS NULL
            ORDER BY updated_at DESC, id ASC`
        )
        .all(normalized.scopeType) as AIMemoryEntry[]
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

  search(scope: AIMemoryScope, query: string, locale = 'zh-CN'): AIMemorySearchResult {
    const startedAt = Date.now()
    const result = rankMemoryEntries(this.list(scope), { query, locale })
    appLogger.debug('ai-memory', 'AI memory relevance search completed', {
      candidateCount: result.entries.length,
      matchedCount: result.matchedCount,
      retrievalMode: result.retrievalMode,
      durationMs: Date.now() - startedAt,
    })
    return result
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

  linkSourceMessages(links: Array<{ id: string; sourceAIChatId: string; sourceMessageId: string }>): string[] {
    if (links.length === 0) return []
    return this.runWrite('link sources', () => {
      const db = this.getDb()
      const update = db.prepare(
        `UPDATE ai_memory
            SET source_message_id = ?
          WHERE id = ?
            AND source_ai_chat_id = ?
            AND (source_message_id IS NULL OR source_message_id = ?)`
      )
      return db.transaction(() => {
        const linkedIds: string[] = []
        for (const link of links) {
          const result = update.run(link.sourceMessageId, link.id, link.sourceAIChatId, link.sourceMessageId)
          if (result.changes === 0) throw new Error('AI memory source changed before it could be linked')
          linkedIds.push(link.id)
        }
        return linkedIds
      })()
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
      if (normalized.scopeType === 'global' || normalized.scopeType === 'self') {
        return db.prepare('DELETE FROM ai_memory WHERE scope_type = ? AND scope_id IS NULL').run(normalized.scopeType)
          .changes
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
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('busy_timeout = 5000')
      migrateMemorySchema(db)
    } catch (error) {
      db.close()
      throw error
    }
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

function compareRecentMemoryEntries(left: AIMemoryEntry, right: AIMemoryEntry): number {
  return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
}

function normalizeMemoryLocale(locale?: string): SupportedLocale {
  if (locale?.startsWith('zh-TW')) return 'zh-TW'
  if (locale?.startsWith('zh')) return 'zh-CN'
  if (locale?.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function tokenizeMemoryText(value: string, locale: SupportedLocale): Set<string> {
  const words = locale.startsWith('zh')
    ? segmentChineseMemoryText(value, locale)
    : segment(value, locale, { posFilterMode: 'all', enableStopwords: true })
  const tokens = new Set(words.map(normalizeSearchText).filter((token) => token.length >= 2))
  for (const token of extractNumericMemoryTokens(value)) tokens.add(token)
  for (const token of extractSymbolSuffixMemoryTokens(value)) tokens.add(token)
  if (locale.startsWith('zh')) {
    for (const token of extractCjkBigrams(value)) tokens.add(token)
  }
  return tokens
}

function extractNumericMemoryTokens(value: string): string[] {
  return value.normalize('NFKC').match(NUMERIC_MEMORY_TOKEN_REGEX) ?? []
}

function extractSymbolSuffixMemoryTokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase().match(SYMBOL_SUFFIX_MEMORY_TOKEN_REGEX) ?? []
}

function segmentChineseMemoryText(value: string, locale: SupportedLocale): string[] {
  try {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
    return [...segmenter.segment(value)].filter((item) => item.isWordLike).map((item) => item.segment)
  } catch {
    return value.match(/[\p{Letter}\p{Number}]+/gu) ?? []
  }
}

function extractCjkBigrams(value: string): string[] {
  const runs = value.normalize('NFKC').match(/[\p{Script=Han}]+/gu) ?? []
  return runs.flatMap((run) =>
    Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2))
  )
}

function scoreMemoryEntry(
  content: string,
  normalizedQuery: string,
  queryTokens: Set<string>,
  locale: SupportedLocale
): number {
  const normalizedContent = normalizeSearchText(content)
  let score = 0
  const matchesFullQuery =
    normalizedQuery.length >= AI_MEMORY_SUBSTRING_MIN_CHARS && normalizedContent.includes(normalizedQuery)
  const isMeaningfulReverseMatch =
    normalizedContent.length >= AI_MEMORY_SUBSTRING_MIN_CHARS && normalizedQuery.includes(normalizedContent)
  if (matchesFullQuery || isMeaningfulReverseMatch) score += 3

  if (queryTokens.size === 0) return score
  const contentTokens = tokenizeMemoryText(content, locale)
  if (contentTokens.size === 0) return score

  let overlap = 0
  for (const token of queryTokens) {
    if (contentTokens.has(token)) overlap += 1
  }
  if (overlap === 0) return score

  return score + (overlap / queryTokens.size) * 2 + overlap / contentTokens.size
}

function normalizeScope(scope: AIMemoryScope): AIMemoryScope {
  const scopeType = scope.scopeType
  if (scopeType !== 'global' && scopeType !== 'self' && scopeType !== 'contact' && scopeType !== 'group') {
    throw new Error(`Unsupported AI memory scope type: ${String(scopeType)}`)
  }

  const scopeId = normalizeOptionalId(scope.scopeId)
  if (scopeType === 'global' || scopeType === 'self') {
    if (scopeId !== null) throw new Error(`${scopeType} AI memory scopeId must be null`)
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

function migrateMemorySchema(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > AI_MEMORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported AI memory schema version: ${version}`)
  }
  if (version === AI_MEMORY_SCHEMA_VERSION) return
  if (version !== 0) {
    throw new Error(`Unsupported AI memory schema version: ${version}`)
  }

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE ai_memory (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'self', 'contact', 'group')),
        scope_id TEXT,
        content TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('user', 'ai')),
        source_ai_chat_id TEXT,
        source_message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (
          (scope_type IN ('global', 'self') AND scope_id IS NULL) OR
          (scope_type IN ('contact', 'group') AND scope_id IS NOT NULL)
        )
      );
    `)

    db.exec(`
      CREATE INDEX idx_ai_memory_scope_updated
        ON ai_memory(scope_type, scope_id, updated_at DESC, id ASC);
    `)
    db.pragma(`user_version = ${AI_MEMORY_SCHEMA_VERSION}`)
  })

  migrate()
  appLogger.info('ai-memory', 'AI memory database schema migrated', {
    fromVersion: version,
    toVersion: AI_MEMORY_SCHEMA_VERSION,
  })
}
