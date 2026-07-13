import { IMPORT_IN_PROGRESS_ERROR_KEY } from '@openchatlab/node-runtime/src/import/import-lock'
import type { PushImportAnalysisResult } from '@openchatlab/node-runtime/src/services/push-importer'
import type { AnalyzeNewImportResult } from '@openchatlab/node-runtime/src/import/streaming-importer'
import { importFailed, importInProgress, type ApiError } from '../errors'

export function apiErrorFromImportResult(error: string | undefined, fallbackMessage: string): ApiError {
  return error === IMPORT_IN_PROGRESS_ERROR_KEY ? importInProgress() : importFailed(error || fallbackMessage)
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

export function analysisFromPushImport(result: PushImportAnalysisResult): {
  totalInFile: number
  newMessageCount: number
  duplicateCount: number
  newMemberCount?: number
} {
  const analysis = {
    totalInFile: result.totalInFile,
    newMessageCount: result.newMessageCount,
    duplicateCount: result.duplicateCount,
  }
  return result.created ? { ...analysis, newMemberCount: result.newMemberCount } : analysis
}
