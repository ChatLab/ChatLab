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
 *   application/json     → parse body → temp .json → chatlab parser
 *   application/x-ndjson → pipe raw stream → temp .jsonl → chatlab-jsonl parser
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { getTempDir } from '../../paths'
import * as worker from '../../worker/workerManager'
import {
  successResponse,
  importInProgress,
  importFailed,
  invalidFormat,
  invalidPayload,
  idempotencyConflict,
  errorResponse,
} from '../errors'
import { apiLogger } from '../logger'

let isImporting = false

// ==================== Idempotency cache ====================

interface IdempotencyCacheEntry {
  bodyHash: string
  status: 'pending' | 'success'
  response: any
  timestamp: number
}

const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000 // 1 hour
const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const idempotencyCache = new Map<string, IdempotencyCacheEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of idempotencyCache) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key)
    }
  }
}, IDEMPOTENCY_CLEANUP_INTERVAL_MS)

function computeBodyHash(body: unknown, tempFile?: string): string {
  if (tempFile && fs.existsSync(tempFile)) {
    const content = fs.readFileSync(tempFile)
    return crypto.createHash('sha256').update(content).digest('hex')
  }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? ''))
    .digest('hex')
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

function idempotencySuccess(key: string | undefined, response: any): void {
  if (!key) return
  const entry = idempotencyCache.get(key)
  if (entry) {
    entry.status = 'success'
    entry.response = response
  }
}

function idempotencyFail(key: string | undefined): void {
  if (!key) return
  idempotencyCache.delete(key)
}

export function getImportingStatus(): boolean {
  return isImporting
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
  if (isImporting) {
    const err = importInProgress()
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

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined
  const isDryRun = (request.headers['x-dry-run'] as string)?.toLowerCase() === 'true'

  const cacheKey = idempotencyKey ? `${idempotencyKey}:${sessionId}:${isDryRun}` : undefined

  isImporting = true
  let tempFile = ''

  try {
    const writeResult = await writeTempFile(request, isJson)
    if (writeResult.error) {
      const err = invalidFormat(writeResult.error)
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }
    tempFile = writeResult.tempFile

    // Idempotency-Key check (after tempFile is written so we can hash JSONL content)
    if (cacheKey) {
      const bodyHash = isJsonl ? computeBodyHash(null, tempFile) : computeBodyHash(request.body)
      const cached = idempotencyCache.get(cacheKey)
      if (cached) {
        if (cached.bodyHash !== bodyHash) {
          const err = idempotencyConflict()
          reply.code(err.statusCode).send(errorResponse(err))
          return
        }
        if (cached.status === 'pending') {
          reply.code(409).send(
            errorResponse({
              statusCode: 409,
              code: 'IDEMPOTENCY_PENDING',
              message: 'A request with this Idempotency-Key is still in progress. Please retry later.',
            })
          )
          return
        }
        reply.send(cached.response)
        return
      }
      idempotencyCache.set(cacheKey, { bodyHash, status: 'pending', response: null, timestamp: Date.now() })
    }

    const importOptions =
      isJson && request.body && typeof request.body === 'object' ? (request.body as any).options : undefined

    const exists = sessionExists(sessionId)

    // X-Dry-Run: analyze only, no writes
    if (isDryRun) {
      let responsePayload: any
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
          analysis: {
            totalInFile: result.totalMessages,
            newMessageCount: result.totalMessages,
            duplicateCount: 0,
            newMemberCount: result.totalMembers,
          },
        })
      }
      idempotencySuccess(cacheKey, responsePayload)
      reply.send(responsePayload)
      return
    }

    if (exists) {
      const result = await worker.incrementalImport(sessionId, tempFile, undefined, importOptions)

      if (result.success) {
        try {
          await worker.generateIncrementalSessions(sessionId)
        } catch {
          // non-blocking
        }
        notifySessionListChanged()
        const responsePayload = successResponse({
          sessionId,
          created: false,
          batch: result.batch,
          session: result.session,
          updates: result.updates,
        })
        idempotencySuccess(cacheKey, responsePayload)
        reply.send(responsePayload)
      } else {
        idempotencyFail(cacheKey)
        const err = importFailed(result.error || 'Incremental import failed')
        reply.code(err.statusCode).send(errorResponse(err))
      }
    } else {
      const result = await worker.streamImport(tempFile, undefined, undefined, sessionId)

      if (result.success) {
        notifySessionListChanged()

        const diag = result.diagnostics
        let sessionInfo: any = undefined
        try {
          const s = await worker.getSession(result.sessionId!)
          if (s) {
            sessionInfo = {
              totalCount: s.totalCount,
              memberCount: s.memberCount,
              firstTimestamp: s.firstTimestamp,
              lastTimestamp: s.lastTimestamp,
            }
          }
        } catch {
          // non-blocking
        }

        const responsePayload = successResponse({
          sessionId: result.sessionId,
          created: true,
          batch: diag
            ? {
                receivedCount: diag.messagesReceived,
                writtenCount: diag.messagesWritten,
                duplicateCount: diag.messagesSkipped,
              }
            : undefined,
          session: sessionInfo,
        })
        idempotencySuccess(cacheKey, responsePayload)
        reply.send(responsePayload)
      } else {
        idempotencyFail(cacheKey)
        const err = importFailed(result.error || 'Import failed')
        reply.code(err.statusCode).send(errorResponse(err))
      }
    }
  } catch (error: any) {
    idempotencyFail(cacheKey)
    apiLogger.error('Import error', error)
    const err = importFailed(error.message || 'Import process error')
    reply.code(err.statusCode).send(errorResponse(err))
  } finally {
    isImporting = false
    if (tempFile) {
      cleanupTempFile(tempFile)
    }
  }
}

/**
 * Legacy import handler (backward compatibility)
 */
async function handleLegacyImport(request: FastifyRequest, reply: FastifyReply, sessionId?: string): Promise<void> {
  if (isImporting) {
    const err = importInProgress()
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

  isImporting = true
  let tempFile = ''

  try {
    const writeResult = await writeTempFile(request, isJson)
    if (writeResult.error) {
      const err = invalidFormat(writeResult.error)
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }
    tempFile = writeResult.tempFile

    if (sessionId) {
      const session = await worker.getSession(sessionId)
      if (!session) {
        // Legacy route requires session to exist
        const { sessionNotFound } = await import('../errors')
        const err = sessionNotFound(sessionId)
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }

      const importOptions =
        isJson && request.body && typeof request.body === 'object' ? (request.body as any).options : undefined

      const result = await worker.incrementalImport(sessionId, tempFile, undefined, importOptions)

      if (result.success) {
        try {
          await worker.generateIncrementalSessions(sessionId)
        } catch {
          // non-blocking
        }
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
        const err = importFailed(result.error || 'Incremental import failed')
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
        const err = importFailed(result.error || 'Import failed')
        reply.code(err.statusCode).send(errorResponse(err))
      }
    }
  } catch (error: any) {
    apiLogger.error('Import error', error)
    const err = importFailed(error.message || 'Import process error')
    reply.code(err.statusCode).send(errorResponse(err))
  } finally {
    isImporting = false
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

  const SESSION_ID_RE = /^[A-Za-z0-9._@-]{1,128}$/

  // v3 unified endpoint
  server.post<{ Params: { sessionId: string } }>('/api/v1/imports/:sessionId', async (request, reply) => {
    const { sessionId } = request.params
    if (!SESSION_ID_RE.test(sessionId)) {
      const err = invalidPayload('sessionId must be 1-128 characters of [A-Za-z0-9._@-]')
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }
    await handleUnifiedImport(request, reply, sessionId)
  })

  // Legacy endpoints (deprecated, kept for backward compatibility)
  server.post('/api/v1/import', async (request, reply) => {
    await handleLegacyImport(request, reply)
  })

  server.post<{ Params: { id: string } }>('/api/v1/sessions/:id/import', async (request, reply) => {
    await handleLegacyImport(request, reply, request.params.id)
  })
}
