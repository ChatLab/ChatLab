import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import { getMimeTypeForPath, getSessionMediaDir, isMediaMessageType } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'

interface MediaMessageRow {
  id: number
  type: number
  media_path: string | null
  media_mime: string | null
  media_filename: string | null
}

function isInsideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

export function registerMediaRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  server.get<{ Params: { id: string; messageId: string } }>(
    '/_web/sessions/:id/messages/:messageId/media',
    async (request, reply) => {
      const messageId = Number(request.params.messageId)
      if (!Number.isInteger(messageId) || messageId <= 0) {
        return reply.code(400).send({ success: false, error: 'Invalid message id' })
      }

      const db = ctx.sessionAdapter.ensureReadonly(request.params.id)
      const row = db
        .prepare(
          `SELECT id, type, media_path, media_mime, media_filename
           FROM message
           WHERE id = ?`
        )
        .get(messageId) as MediaMessageRow | undefined

      if (!row) return reply.code(404).send({ success: false, error: 'Message not found' })
      if (!isMediaMessageType(row.type)) {
        return reply.code(400).send({ success: false, error: 'Message is not a media message' })
      }
      if (!row.media_path) return reply.code(404).send({ success: false, error: 'Media file not archived' })

      const sessionMediaDir = path.resolve(getSessionMediaDir(ctx.pathProvider.getUserDataDir(), request.params.id))
      const mediaPath = path.resolve(sessionMediaDir, row.media_path)
      if (!isInsideDirectory(sessionMediaDir, mediaPath)) {
        return reply.code(400).send({ success: false, error: 'Invalid media path' })
      }
      if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
        return reply.code(404).send({ success: false, error: 'Media file not found' })
      }

      const filename = row.media_filename || path.basename(mediaPath)
      reply.header('Content-Type', row.media_mime || getMimeTypeForPath(mediaPath))
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`)
      return reply.send(fs.createReadStream(mediaPath))
    }
  )
}
