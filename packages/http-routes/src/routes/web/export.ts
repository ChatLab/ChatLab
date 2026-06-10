import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { exportService } from '@openchatlab/node-runtime'
import type { ExportFormat } from '@openchatlab/node-runtime'

export function registerExportRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const { sessionAdapter: adapter } = ctx

  server.post<{
    Params: { id: string }
    Body: {
      sessionName: string
      format?: ExportFormat
      timeFilter?: { startTs: number; endTs: number }
    }
  }>('/_web/sessions/:id/export', async (request, reply) => {
    const { id } = request.params
    const body = request.body as any
    const sessionName = body?.sessionName || id
    const format: ExportFormat = body?.format || 'txt'

    const result = exportService.exportFormatted(adapter, {
      sessionId: id,
      sessionName,
      format,
      timeFilter: body.timeFilter,
    })

    if (!result.success) {
      return reply.code(result.totalMessages === 0 ? 404 : 500).send({ error: result.error })
    }

    reply.header('Content-Type', result.mimeType)
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`)
    return reply.send(result.content)
  })
}
