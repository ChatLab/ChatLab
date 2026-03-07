/**
 * Merge & migration API client — replaces window.mergeApi
 *
 * Maps preload IPC calls to HTTP endpoints under /api/merge.
 * In the web app, files are uploaded via FormData instead of local file paths.
 */

import { get, post, upload } from './client'
import type { ConflictCheckResult, MergeParams, MergeResult, FileParseInfo } from '@/types/format'

// ─────────────────────────── mergeApi ───────────────────────────

export const mergeApi = {
  /**
   * Parse a file for merge preview. Uploads the file and returns parse info + a fileKey.
   * The fileKey is used in subsequent check-conflicts and execute calls.
   */
  parseFileInfo: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload<FileParseInfo & { fileKey: string }>('/merge/parse', fd)
  },

  /**
   * Check conflicts between previously-parsed files (identified by fileKeys).
   */
  checkConflicts: (fileKeys: string[]) =>
    post<ConflictCheckResult>('/merge/check-conflicts', { fileKeys }),

  /**
   * Execute the merge.
   * In the web API, filePaths from MergeParams are replaced by fileKeys.
   */
  mergeFiles: (params: MergeParams & { fileKeys: string[] }) =>
    post<MergeResult>('/merge/execute', params),

  /**
   * Clear parse cache.
   */
  clearCache: (fileKey?: string) =>
    post<{ success: boolean }>('/merge/clear-cache', { fileKey }).then((r) => r.success ?? true),
}

// ─────────────────────────── migrationApi ───────────────────────────

export const migrationApi = {
  checkMigration: () =>
    get<{
      needsMigration: boolean
      count: number
      currentVersion: number
      pendingMigrations: Array<{ version: number; userMessage: string }>
    }>('/migration/check'),

  runMigration: () =>
    post<{ success: boolean; migratedCount: number; error?: string }>('/migration/run'),
}
