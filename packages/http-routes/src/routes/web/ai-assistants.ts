import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'
import type { AssistantConfig } from '@openchatlab/node-runtime'
import { BUILTIN_TOOL_CATALOG } from '@openchatlab/core'

type AiAssistantRouteContext = Pick<AiRouteContext, 'assistantManager'>

export function registerAiAssistantRoutes(server: FastifyInstance, ctx: AiAssistantRouteContext): void {
  // Tool catalog is static data — always available regardless of AI context
  server.get('/_web/ai/tools/catalog', async () => {
    return BUILTIN_TOOL_CATALOG
  })

  const mgr = ctx.assistantManager
  if (!mgr) return

  server.get('/_web/ai/assistants', async () => {
    return mgr.getAllAssistants()
  })

  server.get<{ Params: { id: string } }>('/_web/ai/assistants/:id', async (request, reply) => {
    const config = mgr.getAssistantConfig(request.params.id)
    if (!config) return reply.code(404).send({ error: 'Not found' })
    return config
  })

  server.post<{
    Body: Omit<AssistantConfig, 'id'>
  }>('/_web/ai/assistants', async (request) => {
    return mgr.createAssistant(request.body)
  })

  server.put<{
    Params: { id: string }
    Body: Partial<AssistantConfig>
  }>('/_web/ai/assistants/:id', async (request, reply) => {
    const result = mgr.updateAssistant(request.params.id, request.body)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/assistants/:id', async (request, reply) => {
    const result = mgr.deleteAssistant(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Params: { id: string } }>('/_web/ai/assistants/:id/reset', async (request, reply) => {
    const result = mgr.resetAssistant(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Body: { rawMd: string } }>('/_web/ai/assistants/import', async (request) => {
    return mgr.importAssistantFromMd(request.body.rawMd)
  })

  server.post<{ Body: { builtinId: string } }>('/_web/ai/assistants/import-builtin', async (request, reply) => {
    const result = mgr.importAssistant(request.body.builtinId)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Params: { id: string } }>('/_web/ai/assistants/:id/reimport', async (request, reply) => {
    const result = mgr.reimportAssistant(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })
}
