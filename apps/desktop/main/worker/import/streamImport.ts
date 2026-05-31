/**
 * Streaming import — Electron worker adapter.
 *
 * Thin wrapper around @openchatlab/node-runtime StreamingImporter.
 * Provides Electron-specific wiring: worker progress IPC, paths,
 * better-sqlite3 DB creation, and overview cache hook.
 */

import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import {
  BetterSqliteAdapter,
  streamingImport,
  analyzeNewImport as sharedAnalyzeNewImport,
  streamParseFileInfo as sharedStreamParseFileInfo,
  TEMP_DB_SCHEMA,
  computeAndSetOverviewCache,
} from '@openchatlab/node-runtime'
import type { StreamImportDeps, StreamImportResult, ImportLogger } from '@openchatlab/node-runtime'
import { sendProgress, generateSessionId, getDbPath, createDatabaseWithoutIndexes } from './utils'
import {
  getCacheDir,
  getTempDir,
  initPerfLog,
  logPerf,
  logPerfDetail,
  resetPerfLog,
  getCurrentLogFile,
  logError,
  logInfo,
  logSummary,
} from '../core'

export type { StreamImportResult }
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
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(TEMP_DB_SCHEMA)
  return db
}

function buildElectronLogger(): ImportLogger {
  return {
    info: logInfo,
    error: (message: string, err?: Error) => logError(message, err),
    perf: (label: string, messageCount: number, batchSize?: number) => logPerf(label, messageCount, batchSize),
    perfDetail: logPerfDetail,
    summary: logSummary,
    reset: resetPerfLog,
    init: initPerfLog,
    getCurrentLogFile,
  }
}

function buildStreamImportDeps(requestId: string): StreamImportDeps {
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
    onProgress(progress) {
      sendProgress(requestId, progress)
    },
    logger: buildElectronLogger(),
    postImportHook(_db, sessionId) {
      try {
        const dbPath = getDbPath(sessionId)
        const rawDb = new Database(dbPath)
        computeAndSetOverviewCache(new BetterSqliteAdapter(rawDb), sessionId, getCacheDir())
        rawDb.close()
      } catch {
        /* non-fatal */
      }
    },
    generateSessionId,
  }
}

/**
 * Stream import: parse a file and write to DB with batched transactions.
 */
export async function streamImport(
  filePath: string,
  requestId: string,
  formatOptions?: Record<string, unknown>,
  externalSessionId?: string
): Promise<StreamImportResult> {
  return streamingImport(filePath, buildStreamImportDeps(requestId), formatOptions, externalSessionId)
}

/**
 * Dry-run analysis: parse without writing to DB.
 */
export async function analyzeNewImport(
  filePath: string,
  requestId: string
): Promise<{
  totalMessages: number
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
