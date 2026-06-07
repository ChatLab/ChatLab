import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { exportService } from '@openchatlab/node-runtime'

export function registerExportRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const { sessionAdapter: adapter } = ctx

  server.post<{
    Params: { id: string }
    Body: {
      sessionName: string
      filterMode: 'condition' | 'session'
      keywords?: string[]
      timeFilter?: { startTs: number; endTs: number }
      senderIds?: number[]
      contextSize?: number
      segmentIds?: number[]
    }
  }>('/_web/sessions/:id/export/markdown', async (request, reply) => {
    const { id } = request.params
    const body = request.body as any
    const sessionName = body?.sessionName || id

    const { result, content } = exportService.exportMarkdown(adapter, {
      sessionId: id,
      sessionName,
      filterMode: body.filterMode || 'condition',
      keywords: body.keywords,
      timeFilter: body.timeFilter,
      senderIds: body.senderIds,
      contextSize: body.contextSize,
      segmentIds: body.segmentIds,
    })

    if (!result.success) {
      return reply.code(500).send({ error: result.error })
    }

    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(sessionName)}_export.md"`)
    return reply.send(content)
  })
}
