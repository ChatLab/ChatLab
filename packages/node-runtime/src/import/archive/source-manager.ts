import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ZipArchiveReader } from './archive-reader'
import { ArchiveImportError } from './errors'
import { GoogleChatTakeoutResolver } from './google-chat-resolver'
import type { ArchiveResolver, PreparedImportSource } from './types'
import { createChatLabTempDir } from '../../temp-workspace'

const DEFAULT_TTL_MS = 30 * 60 * 1000

interface SourceRecord {
  descriptor: PreparedImportSource
  archivePath: string
  ownsArchive: boolean
  resolver: ArchiveResolver
  lastAccessAt: number
}

export interface ArchiveImportSourceManagerOptions {
  tempRoot?: string
  ttlMs?: number
  now?: () => number
  resolvers?: ArchiveResolver[]
}

export class ArchiveImportSourceManager {
  private readonly records = new Map<string, SourceRecord>()
  private readonly expiredSourceIds = new Set<string>()
  private readonly tempRoot: string
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly resolvers: ArchiveResolver[]

  constructor(options: ArchiveImportSourceManagerOptions = {}) {
    this.tempRoot = options.tempRoot ?? createChatLabTempDir('imports', 'sources-')
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
    this.resolvers = options.resolvers ?? [new GoogleChatTakeoutResolver()]
    fs.mkdirSync(this.tempRoot, { recursive: true })
  }

  prepareLocalArchive(archivePath: string): Promise<PreparedImportSource> {
    return this.prepareArchive(archivePath, false)
  }

  prepareOwnedArchive(archivePath: string): Promise<PreparedImportSource> {
    return this.prepareArchive(archivePath, true)
  }

  private async prepareArchive(archivePath: string, ownsArchive: boolean): Promise<PreparedImportSource> {
    await this.cleanupExpired()
    const reader = new ZipArchiveReader(archivePath)
    try {
      const entries = await reader.listEntries()
      const matches = this.resolvers.filter((resolver) => resolver.detect(entries))
      if (matches.length !== 1) {
        throw new ArchiveImportError(
          'error.archive_unsupported',
          matches.length === 0 ? 'Unsupported archive format' : 'Archive matches multiple import formats'
        )
      }

      const resolver = matches[0]
      const chats = await resolver.scan(reader)
      const createdAt = this.now()
      const sourceId = randomUUID()
      const descriptor: PreparedImportSource = {
        sourceId,
        formatId: resolver.id,
        platform: resolver.platform,
        chats,
        expiresAt: createdAt + this.ttlMs,
      }
      this.records.set(sourceId, {
        descriptor,
        archivePath,
        ownsArchive,
        resolver,
        lastAccessAt: createdAt,
      })
      return descriptor
    } catch (error) {
      if (ownsArchive) this.removePath(archivePath)
      throw error
    }
  }

  /**
   * selected chat 的 JSON 物化目录只在 handler 生命周期内存在。
   * 无论数据库导入成功、失败还是抛异常，finally 都会删除它。
   */
  async withMaterializedChat<T>(
    sourceId: string,
    chatId: string,
    handler: (manifestPath: string) => Promise<T>
  ): Promise<T> {
    const record = await this.getActiveRecord(sourceId)
    const chat = record.descriptor.chats.find((item) => item.chatId === chatId)
    if (!chat) {
      throw new ArchiveImportError(
        'error.google_chat_conversation_incomplete',
        `Archive conversation was not found: ${chatId}`
      )
    }
    const materializedDir = fs.mkdtempSync(path.join(this.tempRoot, `materialized-${sourceId}-`))
    try {
      const reader = new ZipArchiveReader(record.archivePath)
      const materialized = await record.resolver.materialize(reader, chat, materializedDir)
      return await handler(materialized.manifestPath)
    } finally {
      this.removePath(materializedDir)
    }
  }

  async release(sourceId: string): Promise<void> {
    const record = this.records.get(sourceId)
    if (!record) return
    this.records.delete(sourceId)
    if (record.ownsArchive) this.removePath(record.archivePath)
  }

  async cleanupExpired(now = this.now()): Promise<number> {
    let removed = 0
    for (const [sourceId, record] of this.records) {
      if (now - record.lastAccessAt < this.ttlMs) continue
      this.records.delete(sourceId)
      this.expiredSourceIds.add(sourceId)
      if (record.ownsArchive) this.removePath(record.archivePath)
      removed++
    }
    return removed
  }

  async close(): Promise<void> {
    for (const sourceId of Array.from(this.records.keys())) {
      await this.release(sourceId)
    }
    this.removePath(this.tempRoot)
  }

  private async getActiveRecord(sourceId: string): Promise<SourceRecord> {
    const record = this.records.get(sourceId)
    if (!record) {
      const code = this.expiredSourceIds.has(sourceId) ? 'error.import_source_expired' : 'error.import_source_not_found'
      throw new ArchiveImportError(code, `Archive import source is unavailable: ${sourceId}`)
    }

    const now = this.now()
    if (now - record.lastAccessAt >= this.ttlMs) {
      this.records.delete(sourceId)
      this.expiredSourceIds.add(sourceId)
      if (record.ownsArchive) this.removePath(record.archivePath)
      throw new ArchiveImportError('error.import_source_expired', `Archive import source expired: ${sourceId}`)
    }

    record.lastAccessAt = now
    record.descriptor.expiresAt = now + this.ttlMs
    return record
  }

  private removePath(targetPath: string): void {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true })
    } catch {
      // 清理失败不覆盖原始导入错误，残留文件由下次启动或系统临时目录回收。
    }
  }
}
