import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { filterMessagesWithContext, getMultipleSessionsMessages } from '@openchatlab/core'

export function registerAiFilterRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  server.post<{
    Body: {
      sessionId: string
      keywords?: string[]
      timeFilter?: { startTs: number; endTs: number }
      senderIds?: number[]
      contextSize?: number
      page?: number
      pageSize?: number
    }
  }>('/_web/ai/filter-messages', async (request, reply) => {
    const { sessionId, keywords, timeFilter, senderIds, contextSize, page, pageSize } = request.body
    const db = ctx.dbManager.open(sessionId)
    if (!db) return reply.code(404).send({ error: `Session not found: ${sessionId}` })

    try {
      return filterMessagesWithContext(db, { keywords, timeFilter, senderIds, contextSize, page, pageSize })
    } finally {
      db.close()
    }
  })

  server.post<{
    Body: {
      sessionId: string
      chatSessionIds: number[]
      page?: number
      pageSize?: number
    }
  }>('/_web/ai/multiple-sessions-messages', async (request, reply) => {
    const { sessionId, chatSessionIds, page, pageSize } = request.body
    const db = ctx.dbManager.open(sessionId)
    if (!db) return reply.code(404).send({ error: `Session not found: ${sessionId}` })

    try {
      return getMultipleSessionsMessages(db, chatSessionIds, page, pageSize)
    } finally {
      db.close()
    }
  })
}
