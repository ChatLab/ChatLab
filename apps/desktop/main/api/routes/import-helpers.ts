import { IMPORT_IN_PROGRESS_ERROR_KEY } from '@openchatlab/node-runtime/src/import/import-lock'
import type { AnalyzeNewImportResult, ImportDiagnostics } from '@openchatlab/node-runtime/src/import/streaming-importer'
import { importFailed, importInProgress, type ApiError } from '../errors'

export function apiErrorFromImportResult(error: string | undefined, fallbackMessage: string): ApiError {
  return error === IMPORT_IN_PROGRESS_ERROR_KEY ? importInProgress() : importFailed(error || fallbackMessage)
}

export function batchFromStreamDiagnostics(diagnostics: ImportDiagnostics | undefined):
  | {
      receivedCount: number
      writtenCount: number
      duplicateCount: number
    }
  | undefined {
  if (!diagnostics) return undefined
  return {
    receivedCount: diagnostics.messagesReceived,
    writtenCount: diagnostics.messagesWritten,
    duplicateCount: diagnostics.duplicateCount,
  }
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
