import {
  CHAT_DB_INDEXES,
  CHAT_DB_TABLES,
  getHourlyActivity as queryHourlyActivity,
  getMemberActivity as queryMemberActivity,
  getMessageTypeStats as queryMessageTypeStats,
  writeParseResultToDb,
  type HourlyActivity,
  type MemberActivity,
  type MessageTypeStats,
} from '@openchatlab/core'
import { WebRuntimeError } from '../runtime-error'
import type { WorkspaceDatabasePort, WorkspaceDatabaseStage } from '../storage/workspace-database'
import {
  detectBrowserImportFormat,
  parseBrowserImportSource,
  scanBrowserMultiChatSource,
  type BrowserImportFormatId,
  type BrowserImportLogEvent,
  type BrowserImportParseResult,
  type BrowserParseSource,
} from './browser-parser'
import { BrowserSessionCatalog, type BrowserSessionCatalogItem } from './session-catalog'
import { sessionDatabaseFilename, validateSessionId } from './session-paths'

export type { WorkspaceDatabasePort } from '../storage/workspace-database'
export { sessionDatabaseFilename } from './session-paths'

export interface BrowserImportProgress {
  stage: 'detecting' | 'parsing' | 'catalog' | 'saving' | 'done'
  progress: number
  messagesProcessed?: number
}

export interface BrowserSessionImportOptions {
  formatId?: BrowserImportFormatId
  chatIndex?: number
  checkCancelled?: () => void
  onProgress?: (progress: BrowserImportProgress) => void
  onLog?: (event: BrowserImportLogEvent) => void
}

export interface BrowserSessionImportResult {
  sessionId: string
  formatId: BrowserImportFormatId
  messageCount: number
  memberCount: number
  skippedCount: number
}

export interface BrowserTimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

export interface BrowserImportFormatInfo {
  id: BrowserImportFormatId
  name: string
  platform: string
  extensions: string[]
  multiChat?: boolean
}

export interface BrowserMultiChatEntry {
  index: number
  name: string
  type: string
  id: number
  messageCount: number
}

interface BrowserSessionRuntimeOptions {
  createSessionId?: () => string
  now?: () => number
}

const SUPPORTED_FORMATS: BrowserImportFormatInfo[] = [
  { id: 'chatlab', name: 'ChatLab JSON', platform: 'unknown', extensions: ['.json'] },
  { id: 'chatlab-jsonl', name: 'ChatLab JSONL', platform: 'unknown', extensions: ['.jsonl'] },
  { id: 'weflow', name: 'WeFlow JSON', platform: 'weixin', extensions: ['.json'] },
  { id: 'whatsapp-native-txt', name: 'WhatsApp TXT', platform: 'whatsapp', extensions: ['.txt'] },
  { id: 'line-native-txt', name: 'LINE TXT', platform: 'line', extensions: ['.txt'] },
  { id: 'qq-native-txt', name: 'QQ TXT', platform: 'qq', extensions: ['.txt'] },
  {
    id: 'telegram-native',
    name: 'Telegram JSON',
    platform: 'telegram',
    extensions: ['.json'],
    multiChat: true,
  },
  {
    id: 'telegram-native-single',
    name: 'Telegram JSON',
    platform: 'telegram',
    extensions: ['.json'],
  },
]

export class BrowserSessionRuntime {
  private readonly catalog: BrowserSessionCatalog
  private readonly createSessionId: () => string
  private readonly now: () => number

  constructor(
    private readonly database: WorkspaceDatabasePort,
    options: BrowserSessionRuntimeOptions = {}
  ) {
    this.catalog = new BrowserSessionCatalog(database)
    this.createSessionId = options.createSessionId ?? defaultSessionId
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
  }

  detectFormat(source: BrowserParseSource): Promise<BrowserImportFormatId | null> {
    return detectBrowserImportFormat(source)
  }

  getSupportedFormats(): BrowserImportFormatInfo[] {
    return SUPPORTED_FORMATS.map((format) => ({ ...format, extensions: [...format.extensions] }))
  }

  scanMultiChatSource(
    source: BrowserParseSource,
    options: Pick<BrowserSessionImportOptions, 'checkCancelled'> = {}
  ): Promise<BrowserMultiChatEntry[]> {
    return scanBrowserMultiChatSource(source, options)
  }

  async importSource(
    source: BrowserParseSource,
    options: BrowserSessionImportOptions = {}
  ): Promise<BrowserSessionImportResult> {
    options.onProgress?.({ stage: 'detecting', progress: 0 })
    const formatId = options.formatId ?? (await this.detectFormat(source))
    if (!formatId || !SUPPORTED_FORMATS.some((format) => format.id === formatId)) {
      throw new WebRuntimeError('UNSUPPORTED_IMPORT_FORMAT', 'Unsupported Web WASM import format')
    }
    options.checkCancelled?.()

    const parsed = await parseBrowserImportSource(source, {
      formatId,
      chatIndex: options.chatIndex,
      checkCancelled: options.checkCancelled,
      onProgress: (progress) => options.onProgress?.(progress),
      onLog: options.onLog,
    })
    options.checkCancelled?.()
    const messages: BrowserImportParseResult['messages'] = []
    for (const message of parsed.messages) {
      const timestamp = normalizeImportTimestamp(message.timestamp)
      if (timestamp === null) continue
      messages.push(timestamp === message.timestamp ? message : { ...message, timestamp })
    }
    const skippedInvalidTimestampCount = parsed.messages.length - messages.length
    if (messages.length === 0) {
      throw new WebRuntimeError('EMPTY_IMPORT_FILE', 'The import file does not contain any messages')
    }
    if (skippedInvalidTimestampCount > 0) {
      options.onLog?.({
        level: 'info',
        message: 'Invalid browser import timestamps skipped',
        data: { formatId, skippedCount: skippedInvalidTimestampCount },
      })
    }
    const members = mergeInferredMembers(parsed.members, messages)

    const sessionId = this.createSessionId()
    validateSessionId(sessionId)
    const filename = sessionDatabaseFilename(sessionId)
    const importedAt = this.now()
    const item: BrowserSessionCatalogItem = {
      id: sessionId,
      name: parsed.meta.name,
      platform: parsed.meta.platform,
      type: parsed.meta.type,
      importedAt,
      messageCount: messages.length,
      memberCount: members.length,
      groupId: parsed.meta.groupId ?? null,
      groupAvatar: parsed.meta.groupAvatar ?? null,
      ownerId: parsed.meta.ownerId ?? null,
      lastMessageTs: messages.reduce<number | null>(
        (latest, message) => (latest === null || message.timestamp > latest ? message.timestamp : latest),
        null
      ),
      formatId,
    }

    const existingCount = await this.catalog.count()
    await this.database.ensureCapacity(Math.max(8, (existingCount + 2) * 3))
    await this.catalog.beginImport(item)
    options.onProgress?.({ stage: 'catalog', progress: 0.55, messagesProcessed: messages.length })

    try {
      options.checkCancelled?.()
      options.onProgress?.({ stage: 'saving', progress: 0.6, messagesProcessed: 0 })
      const stats = await this.database.withDatabase(filename, CHAT_DB_TABLES, (db) => {
        const result = writeParseResultToDb(db, parsed.meta, members, messages)
        db.exec(CHAT_DB_INDEXES)
        return {
          ...result,
          skippedCount: result.skippedCount + skippedInvalidTimestampCount,
        }
      })
      options.checkCancelled?.()
      await this.catalog.completeImport(sessionId, stats)
      options.onProgress?.({ stage: 'done', progress: 1, messagesProcessed: stats.messageCount })
      return { sessionId, formatId, ...stats }
    } catch (error) {
      await Promise.allSettled([this.database.deleteDatabase(filename), this.catalog.abortImport(sessionId)])
      throw error
    }
  }

  listSessions(onStage?: (stage: WorkspaceDatabaseStage) => void): Promise<BrowserSessionCatalogItem[]> {
    return this.catalog.list(onStage)
  }

  getSession(id: string): Promise<BrowserSessionCatalogItem | null> {
    validateSessionId(id)
    return this.catalog.get(id)
  }

  async deleteSession(id: string): Promise<boolean> {
    validateSessionId(id)
    const session = await this.catalog.get(id)
    if (!session) return false
    await this.database.deleteDatabase(sessionDatabaseFilename(id))
    await this.catalog.deleteRow(id)
    return true
  }

  renameSession(id: string, newName: string): Promise<boolean> {
    validateSessionId(id)
    const name = newName.trim()
    if (!name) throw new WebRuntimeError('INVALID_SESSION_NAME', 'Session name must not be empty')
    if (name.length > 200) throw new WebRuntimeError('INVALID_SESSION_NAME', 'Session name is too long')
    return this.catalog.rename(id, name)
  }

  async getHourlyActivity(id: string, filter?: BrowserTimeFilter): Promise<HourlyActivity[]> {
    validateSessionId(id)
    const session = await this.catalog.get(id)
    if (!session) throw new WebRuntimeError('SESSION_NOT_FOUND', `Session ${id} was not found`)

    return this.database.withDatabase(sessionDatabaseFilename(id), CHAT_DB_TABLES, (db) =>
      queryHourlyActivity(db, filter)
    )
  }

  async getMemberActivity(id: string, filter?: BrowserTimeFilter): Promise<MemberActivity[]> {
    validateSessionId(id)
    const session = await this.catalog.get(id)
    if (!session) throw new WebRuntimeError('SESSION_NOT_FOUND', `Session ${id} was not found`)

    return this.database.withDatabase(sessionDatabaseFilename(id), CHAT_DB_TABLES, (db) =>
      queryMemberActivity(db, filter)
    )
  }

  async getMessageTypeDistribution(id: string, filter?: BrowserTimeFilter): Promise<MessageTypeStats[]> {
    validateSessionId(id)
    const session = await this.catalog.get(id)
    if (!session) throw new WebRuntimeError('SESSION_NOT_FOUND', `Session ${id} was not found`)

    return this.database.withDatabase(sessionDatabaseFilename(id), CHAT_DB_TABLES, (db) =>
      queryMessageTypeStats(db, filter)
    )
  }
}

function normalizeImportTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const timestamp = Number(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function mergeInferredMembers(
  members: BrowserImportParseResult['members'],
  messages: BrowserImportParseResult['messages']
): BrowserImportParseResult['members'] {
  const memberMap = new Map(members.map((member) => [member.platformId, member]))
  for (const message of messages) {
    if (memberMap.has(message.senderPlatformId)) continue
    memberMap.set(message.senderPlatformId, {
      platformId: message.senderPlatformId,
      accountName: message.senderAccountName,
      groupNickname: message.senderGroupNickname,
    })
  }
  return Array.from(memberMap.values())
}

function defaultSessionId(): string {
  if (typeof crypto?.randomUUID !== 'function') {
    throw new WebRuntimeError('RANDOM_UUID_UNAVAILABLE', 'crypto.randomUUID is required to create a browser session')
  }
  return crypto.randomUUID()
}
