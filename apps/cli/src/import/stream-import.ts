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
  IMPORT_IN_PROGRESS_ERROR_KEY,
  ImportInProgressError,
  resolveDefaultBatchConcurrency,
  analyzeAutoImportFile as sharedAnalyzeAutoImportFile,
  autoImportBatch as sharedAutoImportBatch,
  autoImportFile as sharedAutoImportFile,
  streamingImport,
  analyzeNewImport as sharedAnalyzeNewImport,
  analyzeIncrementalImport as sharedAnalyzeIncremental,
  incrementalImport as sharedIncrementalImport,
  withDataDirImportLock,
} from '@openchatlab/node-runtime'
import type {
  StreamImportResult,
  StreamImportDeps,
  ImportProgressCallback,
  IncrementalImportResult,
  IncrementalAnalyzeResult,
  IncrementalImportDeps,
  ImportOptions,
  AnalyzeNewImportResult,
  AutoImportAnalysisResult,
  AutoImportBatchItemResult,
  AutoImportResult,
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
  sessionGapThreshold?: number
  nativeBinding?: string
  onProgress?: (progress: StreamImportProgress) => void
  /** Fix the target session ID instead of auto-generating one. Used by sync/pull adapters. */
  sessionId?: string
}

function generateSessionId(): string {
  const ts = Date.now()
  const rand = crypto.randomBytes(4).toString('hex')
  return `chat_${ts}_${rand}`
}

function buildStreamImportDeps(
  dbManager: DatabaseManager,
  onProgress?: ImportProgressCallback,
  sessionGapThreshold?: number
): StreamImportDeps {
  return {
    openDatabase(sessionId: string) {
      return dbManager.openRawSessionDatabase(sessionId, { create: true, initializeChatTables: true })
    },
    deleteDatabase(sessionId: string) {
      dbManager.deleteSessionDatabaseFiles(sessionId)
    },
    onProgress: onProgress ?? (() => {}),
    generateSessionId,
    sessionGapThreshold,
  }
}

function createProgressAdapter(onProgress?: (progress: StreamImportProgress) => void): ImportProgressCallback {
  if (!onProgress) return () => {}
  return (progress) => onProgress(createProgressAdapterValue(progress))
}

function createProgressAdapterValue(progress: Parameters<ImportProgressCallback>[0]): StreamImportProgress {
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
    case 'saving':
      stage = 'saving'
      pct = 80
      break
    case 'indexing':
      stage = 'indexing'
      pct = 90
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
  return {
    stage,
    progress: pct,
    message: progress.message || '',
    bytesRead: progress.bytesRead,
    totalBytes: progress.totalBytes,
    messagesProcessed: progress.messagesProcessed,
  }
}

function deleteSessionDatabase(dbManager: DatabaseManager, sessionId: string): void {
  dbManager.deleteSessionDatabaseFiles(sessionId)
}

/**
 * High-performance streaming import: parse a file and write to DB
 * with batched transactions, deferred indexes, and FTS.
 */
async function streamImportUnlocked(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions,
  updateCompatibilityGate = true
): Promise<StreamImportResult> {
  const { formatId, chatIndex, sessionGapThreshold, onProgress, sessionId } = options || {}

  const formatOptions: Record<string, unknown> = {}
  if (formatId) formatOptions.formatId = formatId
  if (chatIndex !== undefined) formatOptions.chatIndex = chatIndex

  const progressAdapter = createProgressAdapter(onProgress)

  const deps = buildStreamImportDeps(dbManager, progressAdapter, sessionGapThreshold)
  const result = await streamingImport(filePath, deps, formatOptions, sessionId)
  if (!result.success || !result.sessionId) return result

  if (!updateCompatibilityGate) return result

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

export async function streamImport(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions
): Promise<StreamImportResult> {
  try {
    return await withDataDirImportLock(dbManager.getUserDataDir(), () =>
      streamImportUnlocked(dbManager, filePath, options)
    )
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return { success: false, error: IMPORT_IN_PROGRESS_ERROR_KEY }
    }
    throw error
  }
}

export async function autoImport(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions
): Promise<AutoImportResult> {
  try {
    return await withDataDirImportLock(dbManager.getUserDataDir(), () =>
      autoImportUnlocked(dbManager, filePath, options)
    )
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return { success: false, error: IMPORT_IN_PROGRESS_ERROR_KEY }
    }
    throw error
  }
}

async function autoImportUnlocked(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions,
  updateCompatibilityGate = true
): Promise<AutoImportResult> {
  const { formatId, chatIndex, onProgress, sessionId } = options ?? {}
  const formatOptions: Record<string, unknown> = {}
  if (formatId) formatOptions.formatId = formatId
  if (chatIndex !== undefined) formatOptions.chatIndex = chatIndex
  const progressAdapter = createProgressAdapter(onProgress)

  return sharedAutoImportFile(
    filePath,
    {
      listSessionIds: () => dbManager.listSessionIds(),
      openReadonly: (candidateSessionId) => dbManager.openRawSessionDatabase(candidateSessionId, { readonly: true }),
      onProgress: progressAdapter,
      sessionExists: (candidateSessionId) => dbManager.listSessionIds().includes(candidateSessionId),
      createSession: (sourcePath, sourceFormatOptions, explicitSessionId) =>
        streamImportUnlocked(
          dbManager,
          sourcePath,
          {
            ...options,
            ...sourceFormatOptions,
            sessionId: explicitSessionId,
          },
          updateCompatibilityGate
        ),
      appendSession: (targetSessionId, sourcePath, sourceFormatOptions) =>
        incrementalImportUnlocked(
          dbManager,
          targetSessionId,
          sourcePath,
          {
            ...sourceFormatOptions,
            onProgress: progressAdapter,
          },
          updateCompatibilityGate
        ),
    },
    {
      explicitSessionId: sessionId,
      formatOptions,
    }
  )
}

export interface AutoImportBatchRequest {
  id: string
  filePath: string
  formatId?: string
  chatIndex?: number
  sessionId?: string
}

export interface AutoImportBatchOptions {
  concurrency?: number
  sessionGapThreshold?: number
  signal?: AbortSignal
  onItemStart?: (item: AutoImportBatchRequest, index: number) => void
  onItemProgress?: (item: AutoImportBatchRequest, index: number, progress: StreamImportProgress) => void
  onItemComplete?: (item: AutoImportBatchRequest, index: number, result: AutoImportBatchItemResult) => void
}

export async function autoImportBatch(
  dbManager: DatabaseManager,
  items: AutoImportBatchRequest[],
  options: AutoImportBatchOptions = {}
): Promise<AutoImportBatchItemResult[]> {
  try {
    return await withDataDirImportLock(dbManager.getUserDataDir(), async () => {
      const results = await sharedAutoImportBatch(
        items.map((item) => ({
          id: item.id,
          filePath: item.filePath,
          options: {
            explicitSessionId: item.sessionId,
            formatOptions: {
              ...(item.formatId ? { formatId: item.formatId } : {}),
              ...(item.chatIndex !== undefined ? { chatIndex: item.chatIndex } : {}),
            },
          },
        })),
        {
          listSessionIds: () => dbManager.listSessionIds(),
          openReadonly: (candidateSessionId) =>
            dbManager.openRawSessionDatabase(candidateSessionId, { readonly: true }),
          sessionExists: (candidateSessionId) => dbManager.listSessionIds().includes(candidateSessionId),
          createSession: (sourcePath, sourceFormatOptions, explicitSessionId) =>
            streamImportUnlocked(
              dbManager,
              sourcePath,
              {
                ...sourceFormatOptions,
                sessionId: explicitSessionId,
                sessionGapThreshold: options.sessionGapThreshold,
              },
              false
            ),
          appendSession: (targetSessionId, sourcePath, sourceFormatOptions) =>
            incrementalImportUnlocked(
              dbManager,
              targetSessionId,
              sourcePath,
              {
                ...sourceFormatOptions,
              },
              false
            ),
        },
        {
          concurrency: options.concurrency ?? resolveDefaultBatchConcurrency(items.length),
          signal: options.signal,
          onItemStart: (_item, index) => options.onItemStart?.(items[index], index),
          onItemProgress: (_item, index, progress) =>
            options.onItemProgress?.(items[index], index, createProgressAdapterValue(progress)),
          onItemComplete: (_item, index, result) => options.onItemComplete?.(items[index], index, result),
        }
      )

      if (results.some((result) => result.status === 'success')) {
        try {
          dbManager.raiseCurrentChatDbCompatibilityGate()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          for (const result of results) {
            if (result.status === 'success' && result.result.importMode === 'created' && result.result.sessionId) {
              deleteSessionDatabase(dbManager, result.result.sessionId)
            }
          }
          return results.map((result) =>
            result.status === 'success'
              ? {
                  id: result.id,
                  status: 'failed' as const,
                  error: message,
                  result: { ...result.result, success: false, error: message },
                }
              : result
          )
        }
      }
      return results
    })
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return items.map((item) => ({
        id: item.id,
        status: 'failed' as const,
        error: IMPORT_IN_PROGRESS_ERROR_KEY,
      }))
    }
    throw error
  }
}

export async function analyzeAutoImport(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions
): Promise<AutoImportAnalysisResult> {
  const { formatId, chatIndex, onProgress, sessionId } = options ?? {}
  const formatOptions: Record<string, unknown> = {}
  if (formatId) formatOptions.formatId = formatId
  if (chatIndex !== undefined) formatOptions.chatIndex = chatIndex
  const progressAdapter = createProgressAdapter(onProgress)
  let readonlySessionIds: string[] | undefined
  const listSessionIdsReadonly = (): string[] => (readonlySessionIds ??= dbManager.listSessionIdsReadonly())

  return sharedAnalyzeAutoImportFile(
    filePath,
    {
      listSessionIds: listSessionIdsReadonly,
      openReadonly: (candidateSessionId) => dbManager.openRawSessionDatabase(candidateSessionId, { readonly: true }),
      onProgress: progressAdapter,
      sessionExists: (candidateSessionId) => listSessionIdsReadonly().includes(candidateSessionId),
      analyzeCreateSession: (sourcePath, sourceFormatOptions) =>
        sharedAnalyzeNewImport(sourcePath, progressAdapter, {
          formatId: typeof sourceFormatOptions?.formatId === 'string' ? sourceFormatOptions.formatId : undefined,
          chatIndex: typeof sourceFormatOptions?.chatIndex === 'number' ? sourceFormatOptions.chatIndex : undefined,
        }),
      analyzeAppendSession: (targetSessionId, sourcePath, sourceFormatOptions) =>
        sharedAnalyzeIncremental(targetSessionId, sourcePath, buildIncrementalDeps(dbManager, progressAdapter), {
          formatId: typeof sourceFormatOptions?.formatId === 'string' ? sourceFormatOptions.formatId : undefined,
          chatIndex: typeof sourceFormatOptions?.chatIndex === 'number' ? sourceFormatOptions.chatIndex : undefined,
        }),
    },
    {
      explicitSessionId: sessionId,
      formatOptions,
    }
  )
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
  }
}

async function incrementalImportUnlocked(
  dbManager: DatabaseManager,
  sessionId: string,
  filePath: string,
  options?: ImportOptions & { onProgress?: ImportProgressCallback },
  updateCompatibilityGate = true
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
  if (!updateCompatibilityGate) return result

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

export async function incrementalImport(
  dbManager: DatabaseManager,
  sessionId: string,
  filePath: string,
  options?: ImportOptions & { onProgress?: ImportProgressCallback }
): Promise<IncrementalImportResult> {
  try {
    return await withDataDirImportLock(dbManager.getUserDataDir(), () =>
      incrementalImportUnlocked(dbManager, sessionId, filePath, options)
    )
  } catch (error) {
    if (error instanceof ImportInProgressError) {
      return { success: false, newMessageCount: 0, error: IMPORT_IN_PROGRESS_ERROR_KEY }
    }
    throw error
  }
}

export async function analyzeIncrementalImport(
  dbManager: DatabaseManager,
  sessionId: string,
  filePath: string,
  onProgress?: ImportProgressCallback,
  options?: ImportOptions
): Promise<IncrementalAnalyzeResult> {
  let compatibilityError: DataDirCompatibilityError | null = null
  const result = await sharedAnalyzeIncremental(
    sessionId,
    filePath,
    buildIncrementalDeps(dbManager, onProgress, (error) => {
      compatibilityError = error
    }),
    options
  )
  if (compatibilityError) throw compatibilityError
  return result
}

export async function analyzeNewImport(
  filePath: string,
  onProgress?: ImportProgressCallback,
  options?: Pick<ImportOptions, 'formatId' | 'chatIndex'>
): Promise<AnalyzeNewImportResult> {
  return sharedAnalyzeNewImport(filePath, onProgress ?? (() => {}), options)
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
  AutoImportAnalysisResult,
  ImportOptions,
  AutoImportResult,
}
