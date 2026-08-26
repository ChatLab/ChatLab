import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AIMemoryScope, AIMemoryScopeType, LinkAIMemorySourcesInput } from '@openchatlab/shared-types'
import {
  linkAIMemorySources,
  listAIMemoriesWithSourceStatus,
  resolveAIMemorySourceStatus,
} from '@openchatlab/node-runtime'
import type { AiRouteContext } from '../../context/ai'
import type { MemoryProvenanceCoordinator } from './memory-provenance-coordinator'

type AiMemoryRouteContext = Pick<AiRouteContext, 'aiMemoryService' | 'aiChatManager'>

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

export function registerAiMemoryRoutes(
  server: FastifyInstance,
  ctx: AiMemoryRouteContext,
  memoryProvenanceCoordinator?: MemoryProvenanceCoordinator
): void {
  const memoryService = ctx.aiMemoryService
  if (!memoryService) return
  const aiChatManager = ctx.aiChatManager
  const withSourceStatus = (entry: ReturnType<typeof memoryService.create>) => ({
    ...entry,
    sourceStatus: aiChatManager
      ? resolveAIMemorySourceStatus(entry, aiChatManager)
      : entry.sourceAIChatId
        ? ('unavailable' as const)
        : ('none' as const),
  })

  server.get<{
    Querystring: MemoryScopeInput
  }>('/_web/ai/memories', async (request, reply) => {
    try {
      const { scopeType, scopeId } = request.query
      if (!scopeType) {
        if (scopeId != null) throw new Error('scopeType is required when scopeId is provided')
        return aiChatManager
          ? listAIMemoriesWithSourceStatus(memoryService, aiChatManager)
          : memoryService.list().map((entry) => ({
              ...entry,
              sourceStatus: entry.sourceAIChatId ? ('unavailable' as const) : ('none' as const),
            }))
      }
      const scope = parseScope({ scopeType, scopeId })
      return aiChatManager
        ? listAIMemoriesWithSourceStatus(memoryService, aiChatManager, scope)
        : memoryService.list(scope).map((entry) => ({
            ...entry,
            sourceStatus: entry.sourceAIChatId ? ('unavailable' as const) : ('none' as const),
          }))
    } catch (error) {
      return sendBadRequest(reply, error)
    }
  })

  server.post<{
    Body: Partial<LinkAIMemorySourcesInput>
  }>('/_web/ai/memories/link-sources', async (request, reply) => {
    if (!aiChatManager) {
      return reply.code(503).send({ error: 'AI conversation storage is unavailable' })
    }
    try {
      const body = request.body ?? {}
      const input = {
        provenanceToken: body.provenanceToken ?? '',
        aiChatId: body.aiChatId ?? '',
        userMessageId: body.userMessageId ?? '',
        assistantMessageId: body.assistantMessageId ?? '',
        memoryIds: body.memoryIds ?? [],
      }
      if (!memoryProvenanceCoordinator) throw new Error('Memory provenance coordination is unavailable')
      const provenance = memoryProvenanceCoordinator.validate(input.provenanceToken, input.aiChatId, input.memoryIds)
      const result = linkAIMemorySources(memoryService, aiChatManager, input, provenance)
      memoryProvenanceCoordinator.consume(input.provenanceToken)
      return result
    } catch (error) {
      return sendBadRequest(reply, error)
    }
  })

  server.post<{
    Body: MemoryScopeInput & { content?: string; sourceType?: string }
  }>('/_web/ai/memories', async (request, reply) => {
    try {
      const scope = parseScope(request.body ?? {})
      return withSourceStatus(
        memoryService.create({
          ...scope,
          content: request.body?.content ?? '',
          sourceType: 'user',
          sourceAIChatId: null,
          sourceMessageId: null,
        })
      )
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
      return withSourceStatus(
        memoryService.update(request.params.id, {
          content: request.body?.content ?? '',
          sourceType: 'user',
          sourceAIChatId: null,
          sourceMessageId: null,
        })
      )
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
