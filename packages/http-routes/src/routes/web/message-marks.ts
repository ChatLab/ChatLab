import type { FastifyInstance } from 'fastify'
import { messageMarkService } from '@openchatlab/node-runtime'
import type { RuntimeRouteContext } from '../../context/runtime'

type MessageMarkRouteContext = Pick<RuntimeRouteContext, 'sessionAdapter'>

export function registerMessageMarkRoutes(server: FastifyInstance, ctx: MessageMarkRouteContext): void {
  server.get<{ Params: { id: string; messageId: string } }>(
    '/_web/sessions/:id/messages/:messageId/mark',
    async (request) =>
      messageMarkService.getMessageMark(ctx.sessionAdapter, request.params.id, Number(request.params.messageId))
  )

  server.put<{
    Params: { id: string; messageId: string }
    Body: { categories?: unknown; color?: unknown; comment?: unknown }
  }>('/_web/sessions/:id/messages/:messageId/mark', async (request, reply) => {
    const messageId = Number(request.params.messageId)
    const { categories, color, comment } = request.body ?? {}
    if (
      !Number.isSafeInteger(messageId) ||
      messageId <= 0 ||
      !Array.isArray(categories) ||
      categories.some((category) => typeof category !== 'string') ||
      typeof color !== 'string' ||
      typeof comment !== 'string'
    ) {
      return reply.code(400).send({ error: 'Invalid message mark' })
    }
    return messageMarkService.saveMessageMark(ctx.sessionAdapter, request.params.id, messageId, {
      categories: categories as string[],
      color,
      comment,
    })
  })
}
