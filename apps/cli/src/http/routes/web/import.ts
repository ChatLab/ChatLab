import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import {
  ArchiveImportError,
  ArchiveImportSourceManager,
  createChatLabTempDir,
  getChatLabTempScopeDir,
  importDemoSessions,
  type DatabaseManager,
} from '@openchatlab/node-runtime'
import {
  autoImport,
  autoImportBatch,
  streamImport,
  incrementalImport,
  analyzeIncrementalImport,
  analyzeNewImport,
  detectFormat,
  detectAllFormats,
  getSupportedFormats,
  scanMultiChatFile,
  findEntryFileInDirectory,
} from '../../../import'
import type {
  AutoImportBatchOptions,
  AutoImportBatchRequest,
  AutoImportResult,
  StreamImportOptions,
} from '../../../import'
import { resolveNativeBinding } from './helpers'

const ARCHIVE_UPLOAD_LIMIT = 50 * 1024 * 1024 * 1024

interface ImportRouteOptions {
  sourceManager?: ArchiveImportSourceManager
  runAutoImport?: (filePath: string, options: StreamImportOptions) => Promise<AutoImportResult>
  runAutoImportBatch?: (
    items: AutoImportBatchRequest[],
    options: AutoImportBatchOptions
  ) => ReturnType<typeof autoImportBatch>
  runPreparedImport?: (
    manifestPath: string,
    onProgress: (progress: unknown) => void,
    sessionGapThreshold?: number
  ) => Promise<{ success: boolean; sessionId?: string; error?: string; messageCount?: number; memberCount?: number }>
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function cleanupTemp(...paths: string[]) {
  for (const p of paths) {
    try {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true })
      } else {
        fs.unlinkSync(p)
      }
    } catch {
      /* ignore */
    }
  }
}

export function registerImportRoutes(
  server: FastifyInstance,
  dbManager: DatabaseManager,
  options: ImportRouteOptions = {}
): void {
  const activeBatchControllers = new Map<string, AbortController>()
  const sourceManager = options.sourceManager ?? new ArchiveImportSourceManager()
  const runAutoImport = options.runAutoImport ?? autoImport.bind(null, dbManager)
  const runAutoImportBatch = options.runAutoImportBatch ?? autoImportBatch.bind(null, dbManager)
  const runPreparedImport =
    options.runPreparedImport ??
    (async (manifestPath: string, onProgress: (progress: unknown) => void, sessionGapThreshold?: number) => {
      const result = await runAutoImport(manifestPath, {
        formatId: 'google-chat-takeout',
        sessionGapThreshold,
        nativeBinding: resolveNativeBinding(),
        onProgress: onProgress as any,
      })
      return result
    })

  server.addHook('onClose', async () => {
    await sourceManager.close()
  })

  server.post('/_web/import-sources', async (request, reply) => {
    const data = await (request as any).file({
      limits: { fileSize: ARCHIVE_UPLOAD_LIMIT },
    })
    if (!data) return reply.code(400).send({ success: false, error: 'error.no_file_selected' })

    const uploadPath = path.join(getChatLabTempScopeDir('imports'), `archive-${randomUUID()}.zip`)
    try {
      await pipeline(data.file, fs.createWriteStream(uploadPath, { flags: 'wx' }))
      if (data.file.truncated) {
        cleanupTemp(uploadPath)
        return reply.code(413).send({ success: false, error: 'error.archive_limit_exceeded' })
      }

      const source = await sourceManager.prepareOwnedArchive(uploadPath)
      return { success: true, source }
    } catch (error) {
      cleanupTemp(uploadPath)
      if (error instanceof ArchiveImportError) {
        return reply.code(400).send({ success: false, error: error.code })
      }
      return reply.code(400).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  server.post<{ Params: { sourceId: string }; Body: { chatId?: string; sessionGapThreshold?: number } }>(
    '/_web/import-sources/:sourceId/import',
    async (request, reply) => {
      const chatId = request.body?.chatId
      if (!chatId) return reply.code(400).send({ success: false, error: 'error.no_chat_selected' })

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      function sendEvent(event: string, eventData: unknown) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
      }

      try {
        const sessionGapThreshold = parseOptionalInteger(request.body?.sessionGapThreshold)
        const result = await sourceManager.withMaterializedChat(request.params.sourceId, chatId, (manifestPath) =>
          runPreparedImport(manifestPath, (progress) => sendEvent('progress', progress), sessionGapThreshold)
        )
        if (result.success) {
          sendEvent('done', result)
        } else {
          sendEvent('error', { success: false, error: result.error || 'error.import_failed' })
        }
      } catch (error) {
        sendEvent('error', {
          success: false,
          error:
            error instanceof ArchiveImportError ? error.code : error instanceof Error ? error.message : String(error),
        })
      } finally {
        reply.raw.end()
      }
    }
  )

  server.delete<{ Params: { sourceId: string } }>('/_web/import-sources/:sourceId', async (request) => {
    await sourceManager.release(request.params.sourceId)
    return { success: true }
  })

  server.get('/_web/supported-formats', async () => {
    return getSupportedFormats()
  })

  server.post('/_web/detect-format', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'detect-')
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    try {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      const format = detectFormat(tmpPath)
      const allFormats = detectAllFormats(tmpPath)
      return { format, allFormats }
    } finally {
      cleanupTemp(tmpPath, tmpDir)
    }
  })

  server.post('/_web/scan-multi-chat', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'scan-')
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    try {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      const chats = await scanMultiChatFile(tmpPath)
      return { chats }
    } finally {
      cleanupTemp(tmpPath, tmpDir)
    }
  })

  server.post('/_web/import', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'upload-')
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    const formatId = (data.fields?.formatId as any)?.value as string | undefined
    const chatIndexStr = (data.fields?.chatIndex as any)?.value as string | undefined
    const chatIndex = chatIndexStr !== undefined ? parseInt(chatIndexStr, 10) : undefined
    const sessionGapThreshold = parseOptionalInteger((data.fields?.sessionGapThreshold as any)?.value)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    function sendEvent(event: string, eventData: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
    }

    try {
      const nativeBinding = resolveNativeBinding()
      const result = await runAutoImport(tmpPath, {
        formatId,
        chatIndex,
        sessionGapThreshold,
        nativeBinding,
        onProgress: (p) => sendEvent('progress', p),
      })

      if (result.success) {
        sendEvent('done', result)
      } else {
        sendEvent('error', result)
      }
    } catch (err) {
      sendEvent('error', { success: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      reply.raw.end()
      cleanupTemp(tmpPath, tmpDir)
    }
  })

  server.post('/_web/import/batch', async (request, reply) => {
    const parts = (request as any).parts()
    if (!parts) return reply.code(400).send({ error: 'No files uploaded' })

    const requestedBatchId = request.headers['x-chatlab-import-batch-id']
    const batchId = typeof requestedBatchId === 'string' && requestedBatchId ? requestedBatchId : randomUUID()
    if (activeBatchControllers.has(batchId)) {
      return reply.code(409).send({ error: 'Batch import id is already active' })
    }

    const tmpDir = createChatLabTempDir('imports', 'batch-')
    const items: AutoImportBatchRequest[] = []
    let sessionGapThreshold: number | undefined
    let completed = false
    const controller = new AbortController()
    activeBatchControllers.set(batchId, controller)

    try {
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'sessionGapThreshold') {
          sessionGapThreshold = parseOptionalInteger(part.value)
          continue
        }
        if (part.type !== 'file') continue
        const index = items.length
        const safeName = path.basename(part.filename || `upload-${index}`)
        const filePath = path.join(tmpDir, `${index}-${safeName}`)
        await pipeline(part.file, fs.createWriteStream(filePath, { flags: 'wx' }))
        items.push({ id: String(index), filePath })
      }

      if (items.length === 0) return reply.code(400).send({ error: 'No files uploaded' })

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      reply.raw.once('close', () => {
        if (!completed) controller.abort()
      })

      const sendEvent = (event: string, eventData: unknown) => {
        if (!reply.raw.destroyed) {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
        }
      }
      const results = await runAutoImportBatch(items, {
        sessionGapThreshold,
        signal: controller.signal,
        onItemStart: (_item, index) => sendEvent('batch-start', { index }),
        onItemProgress: (_item, index, progress) => sendEvent('batch-progress', { index, progress }),
        onItemComplete: (_item, index, result) => sendEvent('batch-complete', { index, result }),
      })
      completed = true
      sendEvent('done', results)
    } catch (error) {
      const payload = { error: error instanceof Error ? error.message : String(error) }
      if (!reply.raw.headersSent) return reply.code(500).send(payload)
      if (!reply.raw.destroyed) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`)
      }
    } finally {
      completed = true
      if (activeBatchControllers.get(batchId) === controller) activeBatchControllers.delete(batchId)
      reply.raw.end()
      cleanupTemp(tmpDir)
    }
  })

  server.post<{ Params: { batchId: string } }>('/_web/import/batch/:batchId/cancel', async (request) => {
    const controller = activeBatchControllers.get(request.params.batchId)
    if (!controller) return { success: false, active: false }
    controller.abort()
    return { success: true, active: true }
  })

  // ==================== Directory Import ====================

  server.post('/_web/import-directory', async (request, reply) => {
    const parts = (request as any).parts()
    if (!parts) return reply.code(400).send({ error: 'No files uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'directory-')
    const relativePaths: string[] = []
    const fileBuffers: { data: Buffer; filename: string }[] = []
    let sessionGapThreshold: number | undefined

    try {
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'relativePaths') {
          relativePaths.push(String(part.value))
        } else if (part.type === 'field' && part.fieldname === 'sessionGapThreshold') {
          sessionGapThreshold = parseOptionalInteger(part.value)
        } else if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) {
            chunks.push(chunk)
          }
          fileBuffers.push({ data: Buffer.concat(chunks), filename: part.filename || '' })
        }
      }

      for (let i = 0; i < fileBuffers.length; i++) {
        let relPath = relativePaths[i] || fileBuffers[i].filename || `file_${i}`
        const segments = relPath.split('/')
        if (segments.length > 1) {
          relPath = segments.slice(1).join('/')
        }
        const targetPath = path.resolve(tmpDir, relPath)
        if (!targetPath.startsWith(tmpDir + path.sep)) continue
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, fileBuffers[i].data)
      }

      const entryPath = findEntryFileInDirectory(tmpDir)
      if (!entryPath) {
        return reply.code(400).send({ error: 'No recognizable import format found in directory' })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      function sendEvent(event: string, eventData: unknown) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
      }

      const nativeBinding = resolveNativeBinding()
      const result = await runAutoImport(entryPath, {
        sessionGapThreshold,
        nativeBinding,
        onProgress: (p) => sendEvent('progress', p),
      })

      if (result.success) {
        sendEvent('done', result)
      } else {
        sendEvent('error', result)
      }
    } catch (err) {
      if (!reply.raw.headersSent) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
      }
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) })}\n\n`
      )
    } finally {
      reply.raw.end()
      cleanupTemp(tmpDir)
    }
  })

  // ==================== Incremental Import ====================

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/import/incremental', async (request, reply) => {
    const sessionId = request.params.id
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'incremental-')
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    function sendEvent(event: string, eventData: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
    }

    try {
      const result = await incrementalImport(dbManager, sessionId, tmpPath, {
        onProgress: (p) => sendEvent('progress', p),
      })

      if (result.success) {
        sendEvent('done', result)
      } else {
        sendEvent('error', { success: false, error: result.error })
      }
    } catch (err) {
      sendEvent('error', { success: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      reply.raw.end()
      cleanupTemp(tmpPath, tmpDir)
    }
  })

  server.post<{ Params: { id: string } }>('/_web/sessions/:id/import/incremental/analyze', async (request, reply) => {
    const sessionId = request.params.id
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'analyze-')
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    try {
      return await analyzeIncrementalImport(dbManager, sessionId, tmpPath)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      cleanupTemp(tmpPath, tmpDir)
    }
  })

  // ==================== Analyze New Import (dry-run) ====================

  server.post('/_web/import/analyze', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'analyze-')
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    try {
      return await analyzeNewImport(tmpPath)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      cleanupTemp(tmpPath, tmpDir)
    }
  })

  // ==================== Demo Import ====================

  server.post<{ Body: { locale?: string; timeZone?: string; sessionGapThreshold?: number } }>(
    '/_web/demo/import',
    async (request, reply) => {
      const locale = request.body?.locale === 'cn' ? 'cn' : 'en'
      const targetTimeZone = typeof request.body?.timeZone === 'string' ? request.body.timeZone : undefined
      const sessionGapThreshold = parseOptionalInteger(request.body?.sessionGapThreshold)
      const nativeBinding = resolveNativeBinding()

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      function sendEvent(event: string, eventData: unknown) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(eventData)}\n\n`)
      }

      const result = await importDemoSessions({
        locale,
        tempPrefix: 'cli-demo-',
        targetTimeZone,
        importFile: (filePath) => streamImport(dbManager, filePath, { nativeBinding, sessionGapThreshold }),
        deleteSession: (sessionId) => {
          dbManager.deleteSessionDatabaseFiles(sessionId)
        },
        onProgress: (progress) => sendEvent('progress', progress),
      })
      sendEvent('result', result)
      reply.raw.end()
    }
  )
}
