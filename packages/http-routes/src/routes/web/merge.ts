/**
 * Merge routes — shared across CLI, Electron, and CLI Web.
 *
 * Parse supports dual-mode:
 *   - multipart/form-data → file upload (web/CLI)
 *   - application/json { filePath } → local disk path (Electron)
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { MergeRouteContext } from '../../context/merge'
import type { RuntimeRouteContext } from '../../context/runtime'
import {
  streamParseFileInfo,
  checkConflictsFromSources,
  buildMergedOutput,
  serializeChatLabToJsonl,
  exportSessionToJson,
  TempDbReader,
  TempDbWriter,
  createChatLabTempDir,
} from '@openchatlab/node-runtime'
import type { MergerDataSource } from '@openchatlab/node-runtime'
import { sessionNotFound } from '../../errors'

type MergeRoutesContext = Pick<RuntimeRouteContext, 'dbManager'> & MergeRouteContext

function ensureDb(ctx: MergeRoutesContext, sessionId: string) {
  const db = ctx.dbManager.open(sessionId)
  if (!db) throw sessionNotFound(sessionId)
  return db
}

export function registerMergeRoutes(server: FastifyInstance, ctx: MergeRoutesContext): void {
  const { dbManager, mergeSessionCache: mergeCache, streamImport } = ctx
  if (!mergeCache) return

  // ── parse (dual-mode) ──────────────────────────────────────────────

  server.post('/_web/merge/parse', async (request, reply) => {
    const contentType = request.headers['content-type'] || ''
    let filePath: string
    let cleanupFile = false
    let cleanupDir: string | undefined

    if (contentType.includes('multipart/form-data')) {
      const data = await (request as any).file()
      if (!data) return reply.code(400).send({ error: 'No file uploaded' })

      const tmpDir = createChatLabTempDir('merge', 'upload-')
      const tmpPath = path.join(tmpDir, data.filename || 'upload')
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))
      filePath = tmpPath
      cleanupFile = true
      cleanupDir = tmpDir
    } else {
      const body = request.body as { filePath?: string }
      if (!body?.filePath) return reply.code(400).send({ error: 'Missing filePath in body' })
      if (!fs.existsSync(body.filePath)) return reply.code(400).send({ error: 'File not found' })
      filePath = body.filePath
    }

    try {
      const result = await streamParseFileInfo(filePath, {
        createTempDatabase(sourceFilePath: string) {
          return mergeCache.createTempDatabase(path.basename(sourceFilePath))
        },
        onProgress() {
          /* HTTP parse has no progress stream */
        },
      })

      const filename = path.basename(filePath)
      const handle = mergeCache.store(filename, result.tempDbPath)

      return {
        handle,
        name: result.name,
        format: result.format,
        platform: result.platform,
        messageCount: result.messageCount,
        memberCount: result.memberCount,
        fileSize: result.fileSize,
      }
    } finally {
      if (cleanupFile) {
        try {
          fs.unlinkSync(filePath)
        } catch {
          /* ignore */
        }
      }
      if (cleanupDir) {
        try {
          fs.rmdirSync(cleanupDir)
        } catch {
          /* ignore */
        }
      }
    }
  })

  // ── conflicts ──────────────────────────────────────────────────────

  server.post<{ Body: { handles: string[] } }>('/_web/merge/conflicts', async (request, reply) => {
    const { handles } = request.body as { handles?: string[] }
    if (!handles || !Array.isArray(handles) || handles.length === 0) {
      return reply.code(400).send({ error: 'Missing or empty handles array' })
    }

    const readers: TempDbReader[] = []
    try {
      const dataSources: Array<{ source: MergerDataSource; filename: string }> = []
      for (const handle of handles) {
        const entry = mergeCache.openReader(handle)
        if (!entry) return reply.code(404).send({ error: `Handle not found: ${handle}` })
        readers.push(entry.reader)
        dataSources.push({ source: entry.reader.toDataSource(), filename: entry.filename })
      }
      return checkConflictsFromSources(dataSources)
    } finally {
      for (const r of readers) r.close()
    }
  })

  // ── execute ────────────────────────────────────────────────────────

  server.post<{
    Body: { handles: string[]; outputName: string; format?: 'json' | 'jsonl'; andImport?: boolean }
  }>('/_web/merge/execute', async (request, reply) => {
    const { handles, outputName, format = 'json', andImport } = request.body as any
    if (!handles || !Array.isArray(handles) || handles.length === 0) {
      return reply.code(400).send({ error: 'Missing handles' })
    }
    if (!outputName) {
      return reply.code(400).send({ error: 'Missing outputName' })
    }

    const readers: TempDbReader[] = []
    try {
      const dataSources: Array<{ source: MergerDataSource; filename: string }> = []
      for (const handle of handles) {
        const entry = mergeCache.openReader(handle)
        if (!entry) return reply.code(404).send({ error: `Handle not found: ${handle}` })
        readers.push(entry.reader)
        dataSources.push({ source: entry.reader.toDataSource(), filename: entry.filename })
      }

      const merged = buildMergedOutput(dataSources, outputName)

      let sessionId: string | undefined
      if (andImport) {
        if (!streamImport) {
          return reply.code(501).send({ error: 'Import not available on this server' })
        }
        const jsonData = JSON.stringify(merged.chatLabData)
        const tmpDir = createChatLabTempDir('merge', 'import-')
        const safeName = path.basename(outputName).replace(/[/\\?%*:|"<>]/g, '_') || 'merged'
        const tmpPath = path.join(tmpDir, `${safeName}.json`)
        fs.writeFileSync(tmpPath, jsonData, 'utf-8')

        try {
          const importResult = await streamImport(dbManager, tmpPath)
          sessionId = importResult.sessionId
        } finally {
          try {
            fs.unlinkSync(tmpPath)
          } catch {
            /* ignore */
          }
          try {
            fs.rmdirSync(tmpDir)
          } catch {
            /* ignore */
          }
        }
      }

      for (const handle of handles) {
        mergeCache.delete(handle)
      }

      if (format === 'jsonl') {
        const lines: string[] = []
        for (const line of serializeChatLabToJsonl(merged.chatLabData)) {
          lines.push(line)
        }
        return { success: true, sessionId, data: lines.join('\n') }
      }

      return { success: true, sessionId, data: merged.chatLabData }
    } finally {
      for (const r of readers) r.close()
    }
  })

  // ── clear ──────────────────────────────────────────────────────────

  server.post<{ Body: { handle?: string } }>('/_web/merge/clear', async (request) => {
    const { handle } = (request.body as any) || {}
    if (handle) {
      mergeCache.delete(handle)
    } else {
      mergeCache.clear()
    }
    return { success: true }
  })

  // ── export sessions for merge ──────────────────────────────────────

  server.post<{
    Body: { sessionIds: string[] }
  }>('/_web/sessions/export-for-merge', async (request, reply) => {
    const { sessionIds } = request.body as { sessionIds?: string[] }
    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      return reply.code(400).send({ error: 'Missing sessionIds' })
    }

    const handles: Array<{ sessionId: string; handle: string }> = []
    for (const sid of sessionIds) {
      const db = ensureDb(ctx, sid)
      const exported = exportSessionToJson(db)
      const { db: tempDb, tempDbPath } = mergeCache.createTempDatabase(exported.meta.name)

      const writer = new TempDbWriter(tempDb)
      writer.writeMeta({
        name: exported.meta.name,
        platform: exported.meta.platform,
        type: exported.meta.type,
        groupId: exported.meta.groupId,
        groupAvatar: exported.meta.groupAvatar,
      })
      writer.writeMembers(
        exported.members.map((m) => ({
          platformId: m.platformId,
          accountName: m.accountName,
          groupNickname: m.groupNickname,
          avatar: m.avatar,
        }))
      )
      writer.writeMessages(
        exported.messages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderAccountName: msg.accountName,
          senderGroupNickname: msg.groupNickname,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        }))
      )
      writer.finish()

      const handle = mergeCache.store(exported.meta.name, tempDbPath)
      handles.push({ sessionId: sid, handle })
    }

    return { success: true, handles }
  })
}
