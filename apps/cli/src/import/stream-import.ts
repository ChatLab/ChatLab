/**
 * Server/CLI streaming import — adapter for @openchatlab/node-runtime StreamingImporter.
 *
 * Replaces the old buffered-in-memory approach with the same high-performance
 * streaming pipeline used by Electron (batched transactions, deferred indexes,
 * nickname history, FTS, format fallback).
 */

import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import {
  streamingImport,
  openBetterSqliteDatabase,
  analyzeNewImport as sharedAnalyzeNewImport,
  analyzeIncrementalImport as sharedAnalyzeIncremental,
  incrementalImport as sharedIncrementalImport,
} from '@openchatlab/node-runtime'
import { generateSessionIndex, generateIncrementalSessionIndex } from '@openchatlab/core'
import type {
  StreamImportResult,
  StreamImportDeps,
  ImportProgressCallback,
  IncrementalImportResult,
  IncrementalAnalyzeResult,
  IncrementalImportDeps,
  ImportOptions,
  AnalyzeNewImportResult,
} from '@openchatlab/node-runtime'
import { CHAT_DB_TABLES } from '@openchatlab/core'
import {
  detectFormat as parserDetectFormat,
  detectAllFormats,
  getFormatFeatureById,
  getSupportedFormats as parserGetSupportedFormats,
  scanMultiChatFile as parserScanMultiChatFile,
  findEntryFileInDirectory,
  type FormatFeature,
  type MultiChatInfo,
  type ParseProgress,
} from '@openchatlab/parser'
import * as crypto from 'crypto'

// ==================== Legacy progress interface (for SSE routes) ====================

export interface StreamImportProgress {
  stage: 'detecting' | 'parsing' | 'saving' | 'indexing' | 'done' | 'error'
  progress: number
  message: string
  bytesRead?: number
  totalBytes?: number
  messagesProcessed?: number
}

export interface StreamImportOptions {
  formatId?: string
  chatIndex?: number
  nativeBinding?: string
  onProgress?: (progress: StreamImportProgress) => void
}

function generateSessionId(): string {
  const ts = Date.now()
  const rand = crypto.randomBytes(4).toString('hex')
  return `chat_${ts}_${rand}`
}

function resolveNativeBinding(dbManager: DatabaseManager): string | undefined {
  return (dbManager as any).nativeBinding
}

function buildStreamImportDeps(dbManager: DatabaseManager, onProgress?: ImportProgressCallback): StreamImportDeps {
  const nativeBinding = resolveNativeBinding(dbManager)
  return {
    openDatabase(sessionId: string) {
      const dbPath = dbManager.getDbPath(sessionId)
      const dir = path.dirname(dbPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const db = openBetterSqliteDatabase(dbPath, { nativeBinding })
      db.exec(CHAT_DB_TABLES)
      return db
    },
    deleteDatabase(sessionId: string) {
      const dbPath = dbManager.getDbPath(sessionId)
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          const p = dbPath + suffix
          if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    },
    onProgress: onProgress ?? (() => {}),
    postImportHook(db) {
      try {
        generateSessionIndex(db)
      } catch {
        /* non-fatal: frontend can regenerate via generate-index route */
      }
    },
    generateSessionId,
  }
}

/**
 * High-performance streaming import: parse a file and write to DB
 * with batched transactions, deferred indexes, and FTS.
 */
export async function streamImport(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions
): Promise<StreamImportResult> {
  const { formatId, chatIndex, onProgress } = options || {}

  const formatOptions: Record<string, unknown> = {}
  if (formatId) formatOptions.formatId = formatId
  if (chatIndex !== undefined) formatOptions.chatIndex = chatIndex

  const progressAdapter: ImportProgressCallback = onProgress
    ? (progress) => {
        let stage: StreamImportProgress['stage'] = 'parsing'
        let pct = 0
        switch (progress.stage) {
          case 'detecting':
            stage = 'detecting'
            pct = 5
            break
          case 'parsing':
            stage = 'parsing'
            pct = Math.min(Math.round(progress.percentage * 0.7), 70)
            break
          case 'importing':
          case 'saving':
            stage = 'saving'
            pct = 80
            break
          case 'done':
            stage = 'done'
            pct = 100
            break
          case 'error':
            stage = 'error'
            pct = 0
            break
        }
        onProgress({
          stage,
          progress: pct,
          message: progress.message || '',
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      }
    : () => {}

  const deps = buildStreamImportDeps(dbManager, progressAdapter)
  return streamingImport(filePath, deps, formatOptions)
}

// ==================== Incremental import ====================

function buildIncrementalDeps(dbManager: DatabaseManager, onProgress?: ImportProgressCallback): IncrementalImportDeps {
  const nativeBinding = resolveNativeBinding(dbManager)
  return {
    openDatabase(sessionId: string, readonly?: boolean) {
      const dbPath = dbManager.getDbPath(sessionId)
      if (!fs.existsSync(dbPath)) {
        throw new Error(`Session database not found: ${sessionId}`)
      }
      return openBetterSqliteDatabase(dbPath, { readonly: readonly ?? false, nativeBinding })
    },
    onProgress: onProgress ?? (() => {}),
    postImportHook(db) {
      try {
        generateIncrementalSessionIndex(db)
      } catch {
        /* non-fatal */
      }
    },
  }
}

export async function incrementalImport(
  dbManager: DatabaseManager,
  sessionId: string,
  filePath: string,
  options?: ImportOptions & { onProgress?: ImportProgressCallback }
): Promise<IncrementalImportResult> {
  const { onProgress, ...importOpts } = options || {}
  return sharedIncrementalImport(sessionId, filePath, buildIncrementalDeps(dbManager, onProgress), importOpts)
}

export async function analyzeIncrementalImport(
  dbManager: DatabaseManager,
  sessionId: string,
  filePath: string,
  onProgress?: ImportProgressCallback
): Promise<IncrementalAnalyzeResult> {
  return sharedAnalyzeIncremental(sessionId, filePath, buildIncrementalDeps(dbManager, onProgress))
}

export async function analyzeNewImport(
  filePath: string,
  onProgress?: ImportProgressCallback
): Promise<AnalyzeNewImportResult> {
  return sharedAnalyzeNewImport(filePath, onProgress ?? (() => {}))
}

// ==================== Re-exports from parser ====================

export {
  parserDetectFormat as detectFormat,
  detectAllFormats,
  getFormatFeatureById,
  parserGetSupportedFormats as getSupportedFormats,
  parserScanMultiChatFile as scanMultiChatFile,
  findEntryFileInDirectory,
}
export type { FormatFeature, MultiChatInfo, ParseProgress }
export type {
  StreamImportResult,
  IncrementalImportResult,
  IncrementalAnalyzeResult,
  AnalyzeNewImportResult,
  ImportOptions,
}
