/**
 * Server/CLI streaming import — adapter for @openchatlab/node-runtime StreamingImporter.
 *
 * Replaces the old buffered-in-memory approach with the same high-performance
 * streaming pipeline used by Electron (batched transactions, deferred indexes,
 * nickname history, FTS, format fallback).
 */

import type { DatabaseManager } from '@openchatlab/node-runtime'
import {
  DataDirCompatibilityError,
  streamingImport,
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

function buildStreamImportDeps(dbManager: DatabaseManager, onProgress?: ImportProgressCallback): StreamImportDeps {
  return {
    openDatabase(sessionId: string) {
      return dbManager.openRawSessionDatabase(sessionId, { create: true, initializeChatTables: true })
    },
    deleteDatabase(sessionId: string) {
      dbManager.deleteSessionDatabaseFiles(sessionId)
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

function deleteSessionDatabase(dbManager: DatabaseManager, sessionId: string): void {
  dbManager.deleteSessionDatabaseFiles(sessionId)
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
  const result = await streamingImport(filePath, deps, formatOptions)
  if (!result.success || !result.sessionId) return result

  try {
    dbManager.raiseCurrentChatDbCompatibilityGate()
  } catch (error) {
    deleteSessionDatabase(dbManager, result.sessionId)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: result.diagnostics,
    }
  }

  return result
}

// ==================== Incremental import ====================

function buildIncrementalDeps(
  dbManager: DatabaseManager,
  onProgress?: ImportProgressCallback,
  onCompatibilityError?: (error: DataDirCompatibilityError) => void
): IncrementalImportDeps {
  return {
    openDatabase(sessionId: string, readonly?: boolean) {
      try {
        return dbManager.openRawSessionDatabase(sessionId, { readonly: readonly ?? false })
      } catch (error) {
        if (error instanceof DataDirCompatibilityError) onCompatibilityError?.(error)
        throw error
      }
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
  let compatibilityError: DataDirCompatibilityError | null = null
  const result = await sharedIncrementalImport(
    sessionId,
    filePath,
    buildIncrementalDeps(dbManager, onProgress, (error) => {
      compatibilityError = error
    }),
    importOpts
  )
  if (compatibilityError) throw compatibilityError
  if (!result.success) return result

  try {
    dbManager.raiseCurrentChatDbCompatibilityGate()
  } catch (error) {
    return {
      ...result,
      success: false,
      newMessageCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  return result
}

export async function analyzeIncrementalImport(
  dbManager: DatabaseManager,
  sessionId: string,
  filePath: string,
  onProgress?: ImportProgressCallback
): Promise<IncrementalAnalyzeResult> {
  let compatibilityError: DataDirCompatibilityError | null = null
  const result = await sharedAnalyzeIncremental(
    sessionId,
    filePath,
    buildIncrementalDeps(dbManager, onProgress, (error) => {
      compatibilityError = error
    })
  )
  if (compatibilityError) throw compatibilityError
  return result
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
