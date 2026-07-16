/**
 * ChatLab API — Import routes (Push mode)
 *
 * POST /api/v1/imports/:sessionId  Unified import endpoint (auto-create or incremental)
 *
 * Legacy (deprecated, kept for backward compatibility):
 * POST /api/v1/import              Import to new session (auto-generated sessionId)
 * POST /api/v1/sessions/:id/import Incremental import to existing session
 *
 * Content-Type dispatch:
 *   application/json     → shared JSON Push HTTP handler → Desktop worker
 *   application/x-ndjson → raw stream → temp .jsonl → shared auto-import orchestration
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { ImportIdempotencyCache, isValidImportSessionId } from '@openchatlab/node-runtime'
import {
  buildImportIdempotencyCacheKey,
  createJsonPushImportHandler,
  type ImportSuccessResponse,
} from '@openchatlab/http-routes/import'
import {
  ApiError,
  ApiErrorCode,
  successResponse,
  apiErrorFromUnknown,
  importFailed,
  invalidFormat,
  invalidPayload,
  idempotencyConflict,
  idempotencyPending,
  errorResponse,
} from '@openchatlab/http-routes/errors'
import { getTempDir } from '../../paths/locations'
import * as worker from '../../worker/workerManager'
import { apiLogger } from '../logger'
import {
  DESKTOP_IMPORT_IN_PROGRESS_MESSAGE,
  analysisFromNewImport,
  apiErrorFromImportResult,
  desktopImportInProgressError,
} from './import-helpers'

// Tracks active External API requests; the shared data-directory lock enforces writer exclusion.
const isImporting = new Set<string>()

const idempotencyCache = new ImportIdempotencyCache<ImportSuccessResponse>()

const handleJsonPushImport = createJsonPushImportHandler({
  execute: worker.pushImport,
  analyze: worker.analyzePushImport,
  idempotencyCache,
  includeDryRunInIdempotencyKey: true,
  importInProgressMessage: DESKTOP_IMPORT_IN_PROGRESS_MESSAGE,
  acquire: (sessionId) => {
    if (isImporting.has(sessionId)) return false
    isImporting.add(sessionId)
    return true
  },
  release: (sessionId) => {
    isImporting.delete(sessionId)
  },
  onSuccess: () => notifySessionListChanged(),
  onError: (error) => apiLogger.error('Import error', error),
})

function computeTempFileHash(tempFile: string): string {
  const content = fs.readFileSync(tempFile)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(getTempDir(), `api-import-${id}${ext}`)
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (err) {
    apiLogger.error('Failed to cleanup temp file', err)
  }
}

function notifySessionListChanged(): void {
  try {
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      win.webContents.send('api:importCompleted')
    }
  } catch {
    // ignore
  }
}

function idempotencySuccess(key: string | null, response: ImportSuccessResponse): void {
  if (!key) return
  idempotencyCache.success(key, response)
}

function idempotencyFail(key: string | null): void {
  if (!key) return
  idempotencyCache.fail(key)
}

export function getImportingStatus(sessionId?: string): boolean {
  if (sessionId) {
    return isImporting.has(sessionId) || isImporting.has('__legacy__')
  }
  return isImporting.size > 0
}

/**
 * 检查 session 是否已存在（快速文件检测）
 */
function sessionExists(sessionId: string): boolean {
  try {
    const dbDir = worker.getDbDirectory()
    return fs.existsSync(path.join(dbDir, `${sessionId}.db`))
  } catch {
    return false
  }
}

/**
 * 将请求 body 写入临时文件，返回文件路径和解析后的 content type 信息
 */
async function writeTempFile(
  request: FastifyRequest,
  isJson: boolean
): Promise<{ tempFile: string; error?: never } | { tempFile?: never; error: string }> {
  if (isJson) {
    const body = request.body
    if (!body || typeof body !== 'object') {
      return { error: 'Request body is not valid JSON' }
    }
    const tempFile = getTempFilePath('.json')
    fs.writeFileSync(tempFile, JSON.stringify(body), 'utf-8')
    return { tempFile }
  } else {
    const tempFile = getTempFilePath('.jsonl')
    const writeStream = fs.createWriteStream(tempFile)
    await pipeline(request.raw, writeStream)
    return { tempFile }
  }
}

/**
 * v3 统一导入处理：自动判断新建或增量
 */
async function handleUnifiedImport(request: FastifyRequest, reply: FastifyReply, sessionId: string): Promise<void> {
  const contentType = (request.headers['content-type'] || '').toLowerCase()
  const isJsonl = contentType.includes('application/x-ndjson')
  const isJson = contentType.includes('application/json')

  if (!isJsonl && !isJson) {
    const err = invalidFormat('Content-Type must be application/json or application/x-ndjson')
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined
  const isDryRun = (request.headers['x-dry-run'] as string)?.toLowerCase() === 'true'

  if (isJson) {
    const result = await handleJsonPushImport({
      sessionId,
      body: request.body,
      contentType,
      idempotencyKey,
      dryRun: isDryRun,
    })
    reply.code(result.statusCode).send(result.response)
    return
  }

  if (!isValidImportSessionId(sessionId)) {
    const err = invalidPayload(
      "sessionId must be 1-128 safe characters, start with [A-Za-z0-9_@-], and not contain '..'"
    )
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const cacheKey = buildImportIdempotencyCacheKey(idempotencyKey, sessionId, isDryRun, true)

  let tempFile = ''
  let activeRequestRegistered = false
  let idempotencyOwned = false

  try {
    const writeResult = await writeTempFile(request, false)
    if (writeResult.error) {
      const err = invalidFormat(writeResult.error)
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }
    tempFile = writeResult.tempFile!

    if (cacheKey) {
      const bodyHash = computeTempFileHash(tempFile)
      const start = idempotencyCache.start(cacheKey, bodyHash)
      if (start.status === 'conflict') {
        const err = idempotencyConflict()
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }
      if (start.status === 'pending') {
        const err = idempotencyPending()
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }
      if (start.status === 'success') {
        reply.send(start.response)
        return
      }
      idempotencyOwned = true
    }

    // 幂等状态必须先于本地活跃请求检查，确保同 key 并发重试返回
    // IDEMPOTENCY_PENDING；只有本次新占位的 key 才会在锁冲突时释放。
    if (isImporting.has(sessionId)) {
      idempotencyFail(cacheKey)
      const err = desktopImportInProgressError()
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }
    isImporting.add(sessionId)
    activeRequestRegistered = true

    // X-Dry-Run: analyze only, no writes
    if (isDryRun) {
      const exists = sessionExists(sessionId)
      let responsePayload: ImportSuccessResponse
      if (exists) {
        const result = await worker.analyzeIncrementalImport(sessionId, tempFile)
        if (result.error) {
          idempotencyFail(cacheKey)
          const err = invalidFormat(result.error)
          reply.code(err.statusCode).send(errorResponse(err))
          return
        }
        responsePayload = successResponse({
          sessionId,
          created: false,
          dryRun: true,
          analysis: {
            totalInFile: result.totalInFile,
            newMessageCount: result.newMessageCount,
            duplicateCount: result.duplicateCount,
          },
        })
      } else {
        const result = await worker.analyzeNewImport(tempFile)
        if (result.error) {
          idempotencyFail(cacheKey)
          const err = invalidFormat(result.error)
          reply.code(err.statusCode).send(errorResponse(err))
          return
        }
        responsePayload = successResponse({
          sessionId,
          created: true,
          dryRun: true,
          analysis: analysisFromNewImport(result),
        })
      }
      idempotencySuccess(cacheKey, responsePayload)
      idempotencyOwned = false
      reply.send(responsePayload)
      return
    }

    const result = await worker.autoImport(tempFile, undefined, undefined, sessionId)
    if (!result.success || !result.sessionId || !result.importMode) {
      idempotencyFail(cacheKey)
      const err = apiErrorFromImportResult(result.error, 'Import failed')
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }

    let sessionInfo = result.session
    if (!sessionInfo) {
      try {
        const session = await worker.getSession(result.sessionId)
        if (session) {
          sessionInfo = {
            totalCount: session.totalCount,
            memberCount: session.memberCount,
            firstTimestamp: session.firstTimestamp,
            lastTimestamp: session.lastTimestamp,
          }
        }
      } catch {
        // Session statistics are informative and must not turn a successful import into a failure.
      }
    }

    notifySessionListChanged()
    const responsePayload = successResponse({
      sessionId: result.sessionId,
      created: result.importMode === 'created',
      batch: result.batch,
      session: sessionInfo,
      updates: result.updates,
    })
    idempotencySuccess(cacheKey, responsePayload)
    idempotencyOwned = false
    reply.send(responsePayload)
  } catch (error: any) {
    if (idempotencyOwned) idempotencyFail(cacheKey)
    apiLogger.error('Import error', error)
    const apiError = apiErrorFromUnknown(error)
    if (apiError) {
      reply.code(apiError.statusCode).send(errorResponse(apiError))
      return
    }
    const err = importFailed(error.message || 'Import process error')
    reply.code(err.statusCode).send(errorResponse(err))
  } finally {
    if (activeRequestRegistered) isImporting.delete(sessionId)
    if (tempFile) {
      cleanupTempFile(tempFile)
    }
  }
}

/**
 * Legacy import handler (backward compatibility)
 */
async function handleLegacyImport(request: FastifyRequest, reply: FastifyReply, sessionId?: string): Promise<void> {
  const lockKey = sessionId ?? '__legacy__'
  if (isImporting.has(lockKey)) {
    const err = desktopImportInProgressError()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const contentType = (request.headers['content-type'] || '').toLowerCase()
  const isJsonl = contentType.includes('application/x-ndjson')
  const isJson = contentType.includes('application/json')

  if (!isJsonl && !isJson) {
    const err = invalidFormat('Content-Type must be application/json or application/x-ndjson')
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  isImporting.add(lockKey)
  let tempFile = ''

  try {
    const writeResult = await writeTempFile(request, isJson)
    if (writeResult.error) {
      const err = invalidFormat(writeResult.error)
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }
    tempFile = writeResult.tempFile!

    if (sessionId) {
      const session = await worker.getSession(sessionId)
      if (!session) {
        const err = new ApiError(ApiErrorCode.SESSION_NOT_FOUND, `Session not found: ${sessionId}`)
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }

      const importOptions =
        isJson && request.body && typeof request.body === 'object' ? (request.body as any).options : undefined

      const result = await worker.incrementalImport(sessionId, tempFile, undefined, importOptions)

      if (result.success) {
        notifySessionListChanged()
        reply.send(
          successResponse({
            sessionId,
            created: false,
            batch: result.batch,
            session: result.session,
            updates: result.updates,
          })
        )
      } else {
        const err = apiErrorFromImportResult(result.error, 'Incremental import failed')
        reply.code(err.statusCode).send(errorResponse(err))
      }
    } else {
      const result = await worker.streamImport(tempFile)

      if (result.success) {
        notifySessionListChanged()
        reply.send(
          successResponse({
            sessionId: result.sessionId,
            created: true,
          })
        )
      } else {
        const err = apiErrorFromImportResult(result.error, 'Import failed')
        reply.code(err.statusCode).send(errorResponse(err))
      }
    }
  } catch (error: any) {
    apiLogger.error('Import error', error)
    const apiError = apiErrorFromUnknown(error)
    if (apiError) {
      reply.code(apiError.statusCode).send(errorResponse(apiError))
      return
    }
    const err = importFailed(error.message || 'Import process error')
    reply.code(err.statusCode).send(errorResponse(err))
  } finally {
    isImporting.delete(lockKey)
    if (tempFile) {
      cleanupTempFile(tempFile)
    }
  }
}

export function registerImportRoutes(server: FastifyInstance): void {
  // JSONL mode: skip fastify's default body parsing, use request.raw stream directly
  server.addContentTypeParser('application/x-ndjson', (_request, _payload, done) => {
    done(null, undefined)
  })

  // v3 unified endpoint
  server.post<{ Params: { sessionId: string } }>('/api/v1/imports/:sessionId', async (request, reply) => {
    await handleUnifiedImport(request, reply, request.params.sessionId)
  })

  // Legacy endpoints (deprecated, kept for backward compatibility)
  server.post('/api/v1/import', async (request, reply) => {
    await handleLegacyImport(request, reply)
  })

  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/import', async (request, reply) => {
    await handleLegacyImport(request, reply, request.params.id)
  })
}
