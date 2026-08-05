/**
 * Streaming import — Electron worker adapter.
 *
 * Thin wrapper around @openchatlab/node-runtime StreamingImporter.
 * Provides Electron-specific wiring: worker progress IPC, paths,
 * better-sqlite3 DB creation, and overview cache hook.
 */

import * as fs from 'fs'
import * as path from 'path'
import type Database from 'better-sqlite3'
import {
  BetterSqliteAdapter,
  autoImportBatch as sharedAutoImportBatch,
  autoImportFile as sharedAutoImportFile,
  streamingImport,
  analyzeNewImport as sharedAnalyzeNewImport,
  streamParseFileInfo as sharedStreamParseFileInfo,
  TEMP_DB_SCHEMA,
  computeAndSetOverviewCache,
  createImportPerfLogger,
  deleteSessionCache,
  listDatabaseCandidateIds,
} from '@openchatlab/node-runtime'
import type {
  AutoImportBatchItemResult,
  AutoImportResult,
  StreamImportDeps,
  StreamImportResult,
  ImportLogger,
  ImportProgressCallback,
} from '@openchatlab/node-runtime'
import { sendProgress, generateSessionId, getDbPath, createDatabaseWithoutIndexes } from './utils'
import { incrementalImport } from './incrementalImport'
import { getCacheDir, getDbDir, getLogsDir, getTempDir, openRawDatabase } from '../core'
import { getImportLogDir } from '../core/perfLogPath'

export type { StreamImportResult }
export type { AutoImportResult }
export type { AutoImportBatchItemResult }
export type { AnalyzeNewImportResult, StreamParseFileInfoResult } from '@openchatlab/node-runtime'
export type { SkipReasons, ImportDiagnostics } from '@openchatlab/node-runtime'

function generateTempDbPath(sourceFilePath: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath))
  const safeName = baseName.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 50)
  const tempDir = getTempDir()
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  return path.join(tempDir, `merge_${safeName}_${timestamp}_${random}.db`)
}

function createTempDatabase(dbPath: string): Database.Database {
  const db = openRawDatabase(dbPath)
  db.pragma('synchronous = NORMAL')
  db.exec(TEMP_DB_SCHEMA)
  return db
}

function buildElectronLogger(): ImportLogger {
  return createImportPerfLogger(getImportLogDir(getLogsDir()))
}

function buildStreamImportDeps(
  requestId: string,
  sessionGapThreshold?: number,
  onProgress?: ImportProgressCallback
): StreamImportDeps {
  return {
    openDatabase(sessionId: string) {
      const db = createDatabaseWithoutIndexes(sessionId)
      return new BetterSqliteAdapter(db)
    },
    deleteDatabase(sessionId: string) {
      const dbPath = getDbPath(sessionId)
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          const p = dbPath + suffix
          if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    },
    onProgress: onProgress ?? ((progress) => sendProgress(requestId, progress)),
    logger: buildElectronLogger(),
    postImportHook(_db, sessionId) {
      const cacheDir = getCacheDir()
      try {
        const rawDb = openRawDatabase(getDbPath(sessionId))
        computeAndSetOverviewCache(new BetterSqliteAdapter(rawDb), sessionId, cacheDir)
        rawDb.close()
      } catch (err) {
        console.warn('[Worker] postImportHook: failed to refresh overview cache', err)
      }
      if (cacheDir) {
        deleteSessionCache(sessionId, path.join(cacheDir, 'query'))
      }
    },
    generateSessionId,
    sessionGapThreshold,
  }
}

/**
 * Stream import: parse a file and write to DB with batched transactions.
 */
export async function streamImport(
  filePath: string,
  requestId: string,
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string,
  sessionGapThreshold?: number,
  onProgress?: ImportProgressCallback
): Promise<StreamImportResult> {
  return streamingImport(
    filePath,
    buildStreamImportDeps(requestId, sessionGapThreshold, onProgress),
    formatOptions,
    externalSessionId
  )
}

export async function autoImport(
  filePath: string,
  requestId: string,
  formatOptions?: Record<string, unknown>,
  explicitSessionId?: string,
  sessionGapThreshold?: number
): Promise<AutoImportResult> {
  return sharedAutoImportFile(
    filePath,
    {
      listSessionIds: () => listDatabaseCandidateIds(getDbDir()),
      openReadonly: (sessionId) => new BetterSqliteAdapter(openRawDatabase(getDbPath(sessionId), { readonly: true })),
      onProgress: (progress) => sendProgress(requestId, progress),
      sessionExists: (sessionId) => fs.existsSync(getDbPath(sessionId)),
      createSession: (sourcePath, sourceFormatOptions, sessionId, itemProgress) =>
        streamImport(sourcePath, requestId, sourceFormatOptions, sessionId, sessionGapThreshold, itemProgress),
      appendSession: (sessionId, sourcePath, sourceFormatOptions, itemProgress, context) =>
        incrementalImport(
          sessionId,
          sourcePath,
          requestId,
          {
            formatId: typeof sourceFormatOptions?.formatId === 'string' ? sourceFormatOptions.formatId : undefined,
            chatIndex: typeof sourceFormatOptions?.chatIndex === 'number' ? sourceFormatOptions.chatIndex : undefined,
            platformMessageIdScope: context?.platformMessageIdScope,
            senderPlatformIdMappings: context?.senderPlatformIdMappings,
          },
          itemProgress
        ),
    },
    { explicitSessionId, formatOptions }
  )
}

export interface WorkerAutoImportBatchItem {
  id: string
  filePath: string
  formatOptions?: Record<string, unknown>
  explicitSessionId?: string
}

export async function autoImportBatch(
  items: WorkerAutoImportBatchItem[],
  requestId: string,
  concurrency: number,
  sessionGapThreshold?: number,
  signal?: AbortSignal
): Promise<AutoImportBatchItemResult[]> {
  return sharedAutoImportBatch(
    items.map((item) => ({
      id: item.id,
      filePath: item.filePath,
      options: {
        explicitSessionId: item.explicitSessionId,
        formatOptions: item.formatOptions,
      },
    })),
    {
      listSessionIds: () => listDatabaseCandidateIds(getDbDir()),
      openReadonly: (sessionId) => new BetterSqliteAdapter(openRawDatabase(getDbPath(sessionId), { readonly: true })),
      sessionExists: (sessionId) => fs.existsSync(getDbPath(sessionId)),
      createSession: (sourcePath, sourceFormatOptions, sessionId, itemProgress) =>
        streamImport(sourcePath, requestId, sourceFormatOptions, sessionId, sessionGapThreshold, itemProgress),
      appendSession: (sessionId, sourcePath, sourceFormatOptions, itemProgress, context) =>
        incrementalImport(
          sessionId,
          sourcePath,
          requestId,
          {
            formatId: typeof sourceFormatOptions?.formatId === 'string' ? sourceFormatOptions.formatId : undefined,
            chatIndex: typeof sourceFormatOptions?.chatIndex === 'number' ? sourceFormatOptions.chatIndex : undefined,
            platformMessageIdScope: context?.platformMessageIdScope,
            senderPlatformIdMappings: context?.senderPlatformIdMappings,
          },
          itemProgress
        ),
    },
    {
      concurrency,
      signal,
      onItemStart: (_item, index) => {
        sendProgress(requestId, {
          stage: 'detecting',
          percentage: 0,
          message: '',
          bytesRead: 0,
          totalBytes: 0,
          messagesProcessed: 0,
          batchIndex: index,
          batchEvent: 'start',
        } as Parameters<typeof sendProgress>[1])
      },
      onItemProgress: (_item, index, progress) => {
        sendProgress(requestId, {
          ...progress,
          batchIndex: index,
          batchEvent: 'progress',
        } as Parameters<typeof sendProgress>[1])
      },
      onItemComplete: (_item, index, result) => {
        sendProgress(requestId, {
          stage: 'done',
          percentage: 100,
          message: '',
          bytesRead: 0,
          totalBytes: 0,
          messagesProcessed: 0,
          batchIndex: index,
          batchEvent: 'complete',
          batchResult: result,
        } as Parameters<typeof sendProgress>[1])
      },
    }
  )
}

/**
 * Dry-run analysis: parse without writing to DB.
 */
export async function analyzeNewImport(
  filePath: string,
  requestId: string
): Promise<{
  totalMessages: number
  newMessageCount: number
  duplicateCount: number
  totalMembers: number
  meta: { name: string; platform: string; type: string } | null
  error?: string
}> {
  return sharedAnalyzeNewImport(filePath, (progress) => sendProgress(requestId, progress))
}

/**
 * Parse file info into a temp DB (for merge preview).
 */
export async function streamParseFileInfo(
  filePath: string,
  requestId: string
): Promise<{
  name: string
  format: string
  platform: string
  messageCount: number
  memberCount: number
  fileSize: number
  tempDbPath: string
}> {
  return sharedStreamParseFileInfo(filePath, {
    createTempDatabase(sourceFilePath: string) {
      const tempDbPath = generateTempDbPath(sourceFilePath)
      const rawDb = createTempDatabase(tempDbPath)
      return { db: new BetterSqliteAdapter(rawDb), tempDbPath }
    },
    onProgress(progress) {
      sendProgress(requestId, progress)
    },
  })
}
