import {
  hashImportBody,
  ImportIdempotencyCache,
  isValidImportSessionId,
  type PushImportAnalysisOutcome,
  type PushImportOutcome,
  type PushImportPayload,
  type PushImportResult,
} from '@openchatlab/node-runtime'
import {
  apiErrorFromUnknown,
  errorResponse,
  idempotencyConflict,
  idempotencyPending,
  importFailed,
  importInProgress,
  invalidPayload,
  successResponse,
} from '../errors'

export type ImportSuccessResponse = ReturnType<typeof successResponse<unknown>>
type ImportErrorResponse = ReturnType<typeof errorResponse>

export interface JsonPushImportRequest {
  sessionId: string
  body: unknown
  contentType: string
  idempotencyKey?: string
  dryRun?: boolean
}

export interface JsonPushImportHttpResult {
  statusCode: number
  response: ImportSuccessResponse | ImportErrorResponse
}

export interface JsonPushImportHandlerOptions {
  execute: (sessionId: string, payload: PushImportPayload) => Promise<PushImportOutcome>
  analyze?: (sessionId: string, payload: PushImportPayload) => Promise<PushImportAnalysisOutcome>
  idempotencyCache?: ImportIdempotencyCache<ImportSuccessResponse>
  includeDryRunInIdempotencyKey?: boolean
  importInProgressMessage?: string
  acquire?: (sessionId: string) => boolean | Promise<boolean>
  release?: (sessionId: string) => void | Promise<void>
  onSuccess?: (result: PushImportResult) => void | Promise<void>
  onError?: (error: unknown) => void
}

export type JsonPushImportHandler = (request: JsonPushImportRequest) => Promise<JsonPushImportHttpResult>

const INVALID_SESSION_ID_MESSAGE =
  "sessionId must be 1-128 safe characters, start with [A-Za-z0-9_@-], and not contain '..'"

export function buildImportIdempotencyCacheKey(
  idempotencyKey: string | undefined,
  sessionId: string,
  dryRun: boolean,
  includeDryRun: boolean
): string | null {
  if (!idempotencyKey) return null
  return includeDryRun ? `${idempotencyKey}:${sessionId}:${dryRun}` : `${idempotencyKey}:${sessionId}`
}

function errorResult(error: ReturnType<typeof invalidPayload>): JsonPushImportHttpResult {
  return { statusCode: error.statusCode, response: errorResponse(error) }
}

function analysisResponse(sessionId: string, outcome: Extract<PushImportAnalysisOutcome, { ok: true }>) {
  const analysis = {
    totalInFile: outcome.result.totalInFile,
    newMessageCount: outcome.result.newMessageCount,
    duplicateCount: outcome.result.duplicateCount,
  }
  return successResponse({
    sessionId,
    created: outcome.result.created,
    dryRun: true,
    analysis: outcome.result.created ? { ...analysis, newMemberCount: outcome.result.newMemberCount } : analysis,
  })
}

export function createJsonPushImportHandler(options: JsonPushImportHandlerOptions): JsonPushImportHandler {
  const idempotencyCache = options.idempotencyCache ?? new ImportIdempotencyCache<ImportSuccessResponse>()

  return async (request) => {
    const contentType = request.contentType.toLowerCase()
    if (!contentType.includes('application/json')) {
      return errorResult(invalidPayload('Content-Type must be application/json (JSONL is not yet supported)'))
    }
    if (!isValidImportSessionId(request.sessionId)) {
      return errorResult(invalidPayload(INVALID_SESSION_ID_MESSAGE))
    }

    const dryRun = request.dryRun === true
    if (dryRun && !options.analyze) {
      return errorResult(invalidPayload('X-Dry-Run is not yet supported'))
    }

    const cacheKey = buildImportIdempotencyCacheKey(
      request.idempotencyKey,
      request.sessionId,
      dryRun,
      options.includeDryRunInIdempotencyKey === true
    )
    if (cacheKey) {
      const start = idempotencyCache.start(cacheKey, hashImportBody(request.body))
      if (start.status === 'conflict') return errorResult(idempotencyConflict())
      if (start.status === 'pending') return errorResult(idempotencyPending())
      if (start.status === 'success') return { statusCode: 200, response: start.response }
    }

    let acquired = false
    try {
      if (options.acquire) {
        acquired = await options.acquire(request.sessionId)
        if (!acquired) {
          if (cacheKey) idempotencyCache.fail(cacheKey)
          return errorResult(importInProgress(options.importInProgressMessage))
        }
      }

      const payload = (request.body ?? {}) as PushImportPayload
      if (dryRun) {
        const outcome = await options.analyze!(request.sessionId, payload)
        if (!outcome.ok) {
          if (cacheKey) idempotencyCache.fail(cacheKey)
          const error =
            outcome.reason === 'invalid_payload' ? invalidPayload(outcome.message) : importFailed(outcome.message)
          return errorResult(error)
        }

        const response = analysisResponse(request.sessionId, outcome)
        if (cacheKey) idempotencyCache.success(cacheKey, response)
        return { statusCode: 200, response }
      }

      const outcome = await options.execute(request.sessionId, payload)
      if (!outcome.ok) {
        if (cacheKey) idempotencyCache.fail(cacheKey)
        const error =
          outcome.reason === 'import_in_progress'
            ? importInProgress(options.importInProgressMessage)
            : outcome.reason === 'invalid_payload'
              ? invalidPayload(outcome.message)
              : importFailed(outcome.message)
        return errorResult(error)
      }

      const response = successResponse(outcome.result)
      if (cacheKey) idempotencyCache.success(cacheKey, response)
      try {
        await options.onSuccess?.(outcome.result)
      } catch (error) {
        options.onError?.(error)
      }
      return { statusCode: 200, response }
    } catch (error) {
      if (cacheKey) idempotencyCache.fail(cacheKey)
      options.onError?.(error)
      const apiError = apiErrorFromUnknown(error)
      if (apiError) return errorResult(apiError)
      return errorResult(importFailed(error instanceof Error ? error.message : 'Import process error'))
    } finally {
      if (acquired) {
        try {
          await options.release?.(request.sessionId)
        } catch (error) {
          options.onError?.(error)
        }
      }
    }
  }
}
