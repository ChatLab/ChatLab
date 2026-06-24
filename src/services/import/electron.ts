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
} from './types'

function resolveFilePath(file: File | string): string | null {
  if (typeof file === 'string') return file
  return (window as any).electron?.webUtils?.getPathForFile?.(file) ?? null
}

export class ElectronImportAdapter implements ImportAdapter {
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
        options && (options.formatId || options.chatIndex !== undefined)
          ? window.chatApi.importWithOptions(filePath, options as Record<string, unknown>)
          : window.chatApi.import(filePath)

      importPromise
        .then((result: any) => {
          unlisten()
          resolve({
            success: result.success,
            sessionId: result.sessionId,
            error: result.error,
            diagnostics: result.diagnostics,
          })
        })
        .catch((err: Error) => {
          unlisten()
          resolve({ success: false, error: err.message })
        })
    })
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
    onProgress?: (p: ImportProgress) => void
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
      return await window.chatApi.importPreparedChat(sourceId, chatId)
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

  async importDemo(locale: string, onProgress?: (p: DemoProgress) => void): Promise<DemoImportResult> {
    const unlisten = window.chatApi.onDemoProgress((progress: any) => {
      if (progress.stage === 'downloading' || progress.stage === 'importing') {
        onProgress?.({ stage: progress.stage })
      }
    })

    try {
      const result = await window.chatApi.importDemo(locale)
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
    _options?: ImportOptions,
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

      window.chatApi
        .importDirectory(source)
        .then((result: any) => {
          unlisten()
          resolve({
            success: result.success,
            sessionId: result.sessionId,
            error: result.error,
            diagnostics: result.diagnostics,
          })
        })
        .catch((err: Error) => {
          unlisten()
          resolve({ success: false, error: err.message })
        })
    })
  }
}
