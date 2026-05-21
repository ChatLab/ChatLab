import type { FastifyInstance } from 'fastify'
import { sessionService, type SessionRuntimeAdapter } from '@openchatlab/node-runtime'

export function registerSessionRoutes(server: FastifyInstance, adapter: SessionRuntimeAdapter): void {
  server.get('/_web/sessions', async () => {
    return sessionService.listAnalysisSessions(adapter)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id', async (request) => {
    return sessionService.getAnalysisSession(adapter, request.params.id)
  })

  server.delete<{ Params: { id: string } }>('/_web/sessions/:id', async (request, reply) => {
    const { id } = request.params
    try {
      const deleted = sessionService.deleteSession(adapter, id)
      if (!deleted) {
        return reply.code(404).send({ success: false, error: 'File not found' })
      }
      return { success: true }
    } catch (err) {
      return reply.code(500).send({ success: false, error: String(err) })
    }
  })

  server.patch<{ Params: { id: string }; Body: { name: string } }>('/_web/sessions/:id/name', async (request) => {
    sessionService.renameSession(adapter, request.params.id, request.body.name)
    return { success: true }
  })

  server.patch<{ Params: { id: string }; Body: { ownerId: string | null } }>(
    '/_web/sessions/:id/owner',
    async (request) => {
      sessionService.updateSessionOwnerId(adapter, request.params.id, request.body.ownerId ?? null)
      return { success: true }
    }
  )
}
