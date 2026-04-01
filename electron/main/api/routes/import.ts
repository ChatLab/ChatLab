/**
 * ChatLab API — Import routes (Push mode)
 *
 * POST /api/v1/import              Import to new session
 * POST /api/v1/sessions/:id/import Incremental import to existing session
 *
 * Content-Type dispatch:
 *   application/json     → parse body → temp .json → chatlab parser
 *   application/x-ndjson → pipe raw stream → temp .jsonl → chatlab-jsonl parser
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { getTempDir } from '../../paths'
import * as worker from '../../worker/workerManager'
import {
  successResponse,
  sessionNotFound,
  importInProgress,
  importFailed,
  invalidFormat,
  errorResponse,
} from '../errors'

let isImporting = false

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
    console.error('[ChatLab API] Failed to cleanup temp file:', err)
  }
}

/**
 * Notify renderer process to refresh session list.
 * Lazy-requires electron to avoid circular dependency.
 */
function notifySessionListChanged(): void {
  try {
    const { BrowserWindow } = require('electron')
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      win.webContents.send('api:importCompleted')
    }
  } catch {
    // ignore
  }
}

export function getImportingStatus(): boolean {
  return isImporting
}

async function handleImport(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId?: string
): Promise<void> {
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
    if (isJson) {
      // JSON mode: fastify already parsed body, write to temp file
      const body = request.body
      if (!body || typeof body !== 'object') {
        const err = invalidFormat('Request body is not valid JSON')
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }

      tempFile = getTempFilePath('.json')
      fs.writeFileSync(tempFile, JSON.stringify(body), 'utf-8')
    } else {
      // JSONL mode: pipe raw stream to temp file
      tempFile = getTempFilePath('.jsonl')
      const writeStream = fs.createWriteStream(tempFile)
      await pipeline(request.raw, writeStream)
    }

    let result: any

    if (sessionId) {
      // Incremental import to specified session
      const session = await worker.getSession(sessionId)
      if (!session) {
        const err = sessionNotFound(sessionId)
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }

      result = await worker.incrementalImport(sessionId, tempFile)

      if (result.success) {
        try {
          await worker.generateIncrementalSessions(sessionId)
        } catch {
          // non-blocking
        }

        notifySessionListChanged()

        reply.send(
          successResponse({
            mode: 'incremental',
            sessionId,
            newMessageCount: result.newMessageCount,
          })
        )
        return
      } else {
        const err = importFailed(result.error || 'Incremental import failed')
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }
    } else {
      // New session import
      result = await worker.streamImport(tempFile)

      if (result.success) {
        notifySessionListChanged()

        reply.send(
          successResponse({
            mode: 'new',
            sessionId: result.sessionId,
          })
        )
        return
      } else {
        const err = importFailed(result.error || 'Import failed')
        reply.code(err.statusCode).send(errorResponse(err))
        return
      }
    }
  } catch (error: any) {
    console.error('[ChatLab API] Import error:', error)
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
  server.addContentTypeParser(
    'application/x-ndjson',
    (_request, _payload, done) => {
      done(null, undefined)
    }
  )

  // POST /api/v1/import — Import to new session
  server.post('/api/v1/import', async (request, reply) => {
    await handleImport(request, reply)
  })

  // POST /api/v1/sessions/:id/import — Incremental import to existing session
  server.post<{ Params: { id: string } }>(
    '/api/v1/sessions/:id/import',
    async (request, reply) => {
      await handleImport(request, reply, request.params.id)
    }
  )
}
