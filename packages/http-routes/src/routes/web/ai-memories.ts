import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AIMemoryScope, AIMemoryScopeType } from '@openchatlab/shared-types'
import type { AiRouteContext } from '../../context/ai'

type AiMemoryRouteContext = Pick<AiRouteContext, 'aiMemoryService'>

interface MemoryScopeInput {
  scopeType?: string
  scopeId?: string | null
}

function parseScope(input: MemoryScopeInput): AIMemoryScope {
  const scopeType = input.scopeType
  if (scopeType !== 'global' && scopeType !== 'self' && scopeType !== 'contact' && scopeType !== 'group') {
    throw new Error('scopeType must be global, self, contact, or group')
  }

  return {
    scopeType: scopeType as AIMemoryScopeType,
    scopeId: typeof input.scopeId === 'string' ? input.scopeId : null,
  }
}

function sendBadRequest(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
}

export function registerAiMemoryRoutes(server: FastifyInstance, ctx: AiMemoryRouteContext): void {
  const memoryService = ctx.aiMemoryService
  if (!memoryService) return

  server.get<{
    Querystring: MemoryScopeInput
  }>('/_web/ai/memories', async (request, reply) => {
    try {
      const { scopeType, scopeId } = request.query
      if (!scopeType) {
        if (scopeId != null) throw new Error('scopeType is required when scopeId is provided')
        return memoryService.list()
      }
      return memoryService.list(parseScope({ scopeType, scopeId }))
    } catch (error) {
      return sendBadRequest(reply, error)
    }
  })

  server.post<{
    Body: MemoryScopeInput & { content?: string; sourceType?: string }
  }>('/_web/ai/memories', async (request, reply) => {
    try {
      const scope = parseScope(request.body ?? {})
      return memoryService.create({
        ...scope,
        content: request.body?.content ?? '',
        sourceType: 'user',
        sourceAIChatId: null,
        sourceMessageId: null,
      })
    } catch (error) {
      return sendBadRequest(reply, error)
    }
  })

  server.put<{
    Params: { id: string }
    Body: { content?: string; sourceType?: string }
  }>('/_web/ai/memories/:id', async (request, reply) => {
    if (!memoryService.get(request.params.id)) {
      return reply.code(404).send({ error: 'AI memory not found' })
    }
    try {
      return memoryService.update(request.params.id, {
        content: request.body?.content ?? '',
        sourceType: 'user',
        sourceAIChatId: null,
        sourceMessageId: null,
      })
    } catch (error) {
      return sendBadRequest(reply, error)
    }
  })

  server.delete<{
    Params: { id: string }
  }>('/_web/ai/memories/:id', async (request, reply) => {
    if (!memoryService.forget(request.params.id)) {
      return reply.code(404).send({ error: 'AI memory not found' })
    }
    return { success: true }
  })

  server.post<{
    Body: MemoryScopeInput & { all?: boolean }
  }>('/_web/ai/memories/clear', async (request, reply) => {
    const { all, scopeType, scopeId } = request.body ?? {}
    if (all === true) {
      if (scopeType || scopeId != null) {
        return reply.code(400).send({ error: 'all cannot be combined with a scope' })
      }
      return { success: true, cleared: memoryService.clear() }
    }
    if (!scopeType) {
      return reply.code(400).send({ error: 'A scope or all: true is required' })
    }
    try {
      return { success: true, cleared: memoryService.clear(parseScope({ scopeType, scopeId })) }
    } catch (error) {
      return sendBadRequest(reply, error)
    }
  })
}
