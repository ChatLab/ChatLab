/**
 * ElectronImportAdapter — 包装 window.chatApi 导入相关 IPC
 */

import type { ImportProgress } from '@/types/base'
import type {
  ImportAdapter,
  ImportOptions,
  ImportResult,
  FormatInfo,
  MultiChatEntry,
  PreparedImportSourceResult,
  DemoProgress,
  DemoImportResult,
  IncrementalAnalysis,
  IncrementalImportResult,
  BatchImportItem,
  BatchImportItemResult,
  BatchImportProgress,
} from './types'
import { normalizeImportResult } from './types'

function resolveFilePath(file: File | string): string | null {
  if (typeof file === 'string') return file
  return (window as any).electron?.webUtils?.getPathForFile?.(file) ?? null
}

export class ElectronImportAdapter implements ImportAdapter {
  private activeBatchId: string | null = null

  async importFile(
    file: File | string,
    options?: ImportOptions,
    onProgress?: (p: ImportProgress) => void
  ): Promise<ImportResult> {
    const filePath = resolveFilePath(file)
    if (!filePath) {
      return { success: false, error: 'Cannot get file path in Electron' }
    }

    return new Promise((resolve) => {
      const unlisten = window.chatApi.onImportProgress((progress: any) => {
        onProgress?.({
          stage: progress.stage || 'parsing',
          progress: progress.percentage || progress.progress || 0,
          message: progress.message || '',
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      })

      const importPromise =
        options && (options.formatId || options.chatIndex !== undefined || options.sessionGapThreshold !== undefined)
          ? window.chatApi.importWithOptions(filePath, options as Record<string, unknown>)
          : window.chatApi.import(filePath)

      importPromise
        .then((result) => {
          unlisten()
          resolve(
            normalizeImportResult({
              success: result.success,
              sessionId: result.sessionId,
              platform: result.platform,
              error: result.error,
              importMode: result.importMode,
              matchedBy: result.matchedBy,
              createReason: result.createReason,
              newMessageCount: result.newMessageCount,
              duplicateCount: result.duplicateCount,
              diagnostics: result.diagnostics,
            })
          )
        })
        .catch((err: Error) => {
          unlisten()
          resolve({ success: false, error: err.message })
        })
    })
  }

  async importBatch(
    items: BatchImportItem[],
    options?: ImportOptions,
    onProgress?: (progress: BatchImportProgress) => void
  ): Promise<BatchImportItemResult[]> {
    const resolvedItems: Array<{ id: string; filePath: string }> = []
    for (const item of items) {
      const filePath = resolveFilePath(item.file)
      if (!filePath) {
        return items.map((candidate) =>
          candidate.id === item.id
            ? { id: candidate.id, status: 'failed' as const, error: 'Cannot get file path in Electron' }
            : { id: candidate.id, status: 'cancelled' as const }
        )
      }
      resolvedItems.push({ id: item.id, filePath })
    }

    const batchId = crypto.randomUUID()
    this.activeBatchId = batchId
    const unlisten = window.chatApi.onImportBatchProgress((event) => {
      if (event.batchId !== batchId) return
      const index = event.batchIndex
      onProgress?.({
        index,
        event: event.batchEvent,
        progress:
          event.batchEvent === 'progress'
            ? {
                stage: event.stage as ImportProgress['stage'],
                progress: event.percentage,
                message: event.message ?? '',
              }
            : undefined,
        result: event.batchResult as BatchImportItemResult | undefined,
      })
    })

    try {
      const results = await window.chatApi.importBatch(batchId, resolvedItems, {
        sessionGapThreshold: options?.sessionGapThreshold,
      })
      return results.map((item) => {
        if (item.status === 'cancelled') return { id: item.id, status: 'cancelled' }
        if (item.status === 'failed') {
          return {
            id: item.id,
            status: 'failed',
            error: item.error ?? item.result?.error ?? 'error.import_failed',
            result: item.result ? normalizeImportResult(item.result) : undefined,
          }
        }
        return {
          id: item.id,
          status: 'success',
          result: normalizeImportResult(item.result ?? { success: false, error: 'error.import_failed' }),
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return items.map((item) => ({ id: item.id, status: 'failed', error: message }))
    } finally {
      unlisten()
      if (this.activeBatchId === batchId) this.activeBatchId = null
    }
  }

  cancelActiveImport(): void {
    if (this.activeBatchId) void window.chatApi.cancelImportBatch(this.activeBatchId)
  }

  async detectFormat(file: File | string): Promise<FormatInfo | null> {
    const filePath = resolveFilePath(file)
    if (!filePath) return null
    const result = await window.chatApi.detectFormat(filePath)
    if (!result) return null
    return { ...result, extensions: (result as any).extensions ?? [] }
  }

  async scanMultiChatFile(file: File | string): Promise<MultiChatEntry[]> {
    const filePath = resolveFilePath(file)
    if (!filePath) return []
    const result = await window.chatApi.scanMultiChatFile(filePath)
    if (!result.success || !result.chats) return []
    return result.chats
  }

  async prepareImportSource(file: File | string): Promise<PreparedImportSourceResult> {
    const filePath = resolveFilePath(file)
    if (!filePath) return { success: false, error: 'Cannot get file path in Electron' }
    return window.chatApi.prepareImportSource(filePath)
  }

  async importPreparedChat(
    sourceId: string,
    chatId: string,
    onProgress?: (p: ImportProgress) => void,
    options?: ImportOptions
  ): Promise<ImportResult> {
    const unlisten = window.chatApi.onImportProgress((progress: any) => {
      onProgress?.({
        stage: progress.stage || 'parsing',
        progress: progress.percentage || progress.progress || 0,
        message: progress.message || '',
        bytesRead: progress.bytesRead,
        totalBytes: progress.totalBytes,
        messagesProcessed: progress.messagesProcessed,
      })
    })
    try {
      return normalizeImportResult(
        await (options
          ? window.chatApi.importPreparedChat(sourceId, chatId, options as Record<string, unknown>)
          : window.chatApi.importPreparedChat(sourceId, chatId))
      )
    } finally {
      unlisten()
    }
  }

  async releaseImportSource(sourceId: string): Promise<void> {
    await window.chatApi.releaseImportSource(sourceId)
  }

  getSupportedFormats(): Promise<FormatInfo[]> {
    return window.chatApi.getSupportedFormats()
  }

  async importDemo(
    locale: string,
    onProgress?: (p: DemoProgress) => void,
    options?: ImportOptions
  ): Promise<DemoImportResult> {
    const unlisten = window.chatApi.onDemoProgress((progress: any) => {
      if (progress.stage === 'downloading' || progress.stage === 'importing') {
        onProgress?.({ stage: progress.stage })
      }
    })

    try {
      const result = await (options
        ? window.chatApi.importDemo(locale, options as Record<string, unknown>)
        : window.chatApi.importDemo(locale))
      return result
    } finally {
      unlisten()
    }
  }

  async analyzeIncrementalImport(sessionId: string, file: File | string): Promise<IncrementalAnalysis> {
    const filePath = resolveFilePath(file)
    if (!filePath) return { newMessageCount: 0, duplicateCount: 0, totalInFile: 0, error: 'Cannot resolve file path' }
    return window.chatApi.analyzeIncrementalImport(sessionId, filePath)
  }

  async incrementalImport(
    sessionId: string,
    file: File | string,
    onProgress?: (p: ImportProgress) => void
  ): Promise<IncrementalImportResult> {
    const filePath = resolveFilePath(file)
    if (!filePath) return { success: false, newMessageCount: 0, error: 'Cannot resolve file path' }

    const unlisten = window.chatApi.onImportProgress((progress: any) => {
      onProgress?.(progress)
    })

    try {
      const result = await window.chatApi.incrementalImport(sessionId, filePath)
      return result
    } finally {
      unlisten()
    }
  }

  async importDirectory(
    source: File[] | string,
    options?: ImportOptions,
    onProgress?: (p: ImportProgress) => void
  ): Promise<ImportResult> {
    if (typeof source !== 'string') {
      return { success: false, error: 'Expected directory path in Electron mode' }
    }

    return new Promise((resolve) => {
      const unlisten = window.chatApi.onImportProgress((progress: any) => {
        onProgress?.({
          stage: progress.stage || 'parsing',
          progress: progress.percentage || progress.progress || 0,
          message: progress.message || '',
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes,
          messagesProcessed: progress.messagesProcessed,
        })
      })

      const importPromise = options
        ? window.chatApi.importDirectory(source, options as Record<string, unknown>)
        : window.chatApi.importDirectory(source)

      importPromise
        .then((result) => {
          unlisten()
          resolve(
            normalizeImportResult({
              success: result.success,
              sessionId: result.sessionId,
              platform: result.platform,
              error: result.error,
              importMode: result.importMode,
              matchedBy: result.matchedBy,
              createReason: result.createReason,
              newMessageCount: result.newMessageCount,
              duplicateCount: result.duplicateCount,
              diagnostics: result.diagnostics,
            })
          )
        })
        .catch((err: Error) => {
          unlisten()
          resolve({ success: false, error: err.message })
        })
    })
  }
}
