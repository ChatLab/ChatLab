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
import type { AutoImportResult, StreamImportOptions } from '../../../import'
import { resolveNativeBinding } from './helpers'

const ARCHIVE_UPLOAD_LIMIT = 50 * 1024 * 1024 * 1024

interface ImportRouteOptions {
  sourceManager?: ArchiveImportSourceManager
  runAutoImport?: (filePath: string, options: StreamImportOptions) => Promise<AutoImportResult>
  runPreparedImport?: (
    manifestPath: string,
    onProgress: (progress: unknown) => void
  ) => Promise<{ success: boolean; sessionId?: string; error?: string; messageCount?: number; memberCount?: number }>
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
  const sourceManager = options.sourceManager ?? new ArchiveImportSourceManager()
  const runAutoImport = options.runAutoImport ?? autoImport.bind(null, dbManager)
  const runPreparedImport =
    options.runPreparedImport ??
    (async (manifestPath: string, onProgress: (progress: unknown) => void) => {
      const result = await runAutoImport(manifestPath, {
        formatId: 'google-chat-takeout',
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

  server.post<{ Params: { sourceId: string }; Body: { chatId?: string } }>(
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
        const result = await sourceManager.withMaterializedChat(request.params.sourceId, chatId, (manifestPath) =>
          runPreparedImport(manifestPath, (progress) => sendEvent('progress', progress))
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
        nativeBinding,
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

  // ==================== Directory Import ====================

  server.post('/_web/import-directory', async (request, reply) => {
    const parts = (request as any).parts()
    if (!parts) return reply.code(400).send({ error: 'No files uploaded' })

    const tmpDir = createChatLabTempDir('imports', 'directory-')
    const relativePaths: string[] = []
    const fileBuffers: { data: Buffer; filename: string }[] = []

    try {
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'relativePaths') {
          relativePaths.push(String(part.value))
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
        nativeBinding,
        onProgress: (p) => sendEvent('progress', p),
      })

      if (result.success) {
        sendEvent('done', result)
      } else {
        sendEvent('error', { success: false, error: result.error })
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

  server.post<{ Body: { locale?: string; timeZone?: string } }>('/_web/demo/import', async (request, reply) => {
    const locale = request.body?.locale === 'cn' ? 'cn' : 'en'
    const targetTimeZone = typeof request.body?.timeZone === 'string' ? request.body.timeZone : undefined
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
      importFile: (filePath) => streamImport(dbManager, filePath, { nativeBinding }),
      deleteSession: (sessionId) => {
        dbManager.deleteSessionDatabaseFiles(sessionId)
      },
      onProgress: (progress) => sendEvent('progress', progress),
    })
    sendEvent('result', result)
    reply.raw.end()
  })
}
