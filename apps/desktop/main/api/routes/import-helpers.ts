import { IMPORT_IN_PROGRESS_ERROR_KEY } from '@openchatlab/node-runtime/src/import/import-lock'
import type { AnalyzeNewImportResult } from '@openchatlab/node-runtime/src/import/streaming-importer'
import { importFailed, importInProgress, type ApiError } from '@openchatlab/http-routes/errors'

export const DESKTOP_IMPORT_IN_PROGRESS_MESSAGE = 'An import operation is already in progress'

export function desktopImportInProgressError(): ApiError {
  return importInProgress(DESKTOP_IMPORT_IN_PROGRESS_MESSAGE)
}

export function apiErrorFromImportResult(error: string | undefined, fallbackMessage: string): ApiError {
  return error === IMPORT_IN_PROGRESS_ERROR_KEY
    ? desktopImportInProgressError()
    : importFailed(error || fallbackMessage)
}

export function analysisFromNewImport(result: AnalyzeNewImportResult): {
  totalInFile: number
  newMessageCount: number
  duplicateCount: number
  newMemberCount: number
} {
  return {
    totalInFile: result.totalMessages,
    newMessageCount: result.newMessageCount,
    duplicateCount: result.duplicateCount,
    newMemberCount: result.totalMembers,
  }
}
