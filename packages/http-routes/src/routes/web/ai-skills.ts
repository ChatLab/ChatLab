import type { FastifyInstance } from 'fastify'
import type { AiRouteContext } from '../../context/ai'

type AiSkillRouteContext = Pick<AiRouteContext, 'skillManagerCore'>

export function registerAiSkillRoutes(server: FastifyInstance, ctx: AiSkillRouteContext): void {
  const mgr = ctx.skillManagerCore
  if (!mgr) return

  server.get('/_web/ai/skills', async () => {
    return mgr.getAllSkills()
  })

  server.get<{ Params: { id: string } }>('/_web/ai/skills/:id', async (request, reply) => {
    const config = mgr.getSkillConfig(request.params.id)
    if (!config) return reply.code(404).send({ error: 'Not found' })
    return config
  })

  server.post<{ Body: { rawMd: string } }>('/_web/ai/skills', async (request) => {
    return mgr.createSkill(request.body.rawMd)
  })

  server.put<{
    Params: { id: string }
    Body: { rawMd: string }
  }>('/_web/ai/skills/:id', async (request, reply) => {
    const result = mgr.updateSkill(request.params.id, request.body.rawMd)
    if (!result.success) return reply.code(404).send(result)
    return result
  })

  server.delete<{ Params: { id: string } }>('/_web/ai/skills/:id', async (request, reply) => {
    const result = mgr.deleteSkill(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Body: { rawMd: string } }>('/_web/ai/skills/import', async (request) => {
    return mgr.importSkillFromMd(request.body.rawMd)
  })

  server.get('/_web/ai/skills/builtin-catalog', async () => {
    return mgr.getBuiltinCatalog()
  })

  server.post<{ Body: { builtinId: string } }>('/_web/ai/skills/import-builtin', async (request, reply) => {
    const result = mgr.importSkill(request.body.builtinId)
    if (!result.success) return reply.code(400).send(result)
    return result
  })

  server.post<{ Params: { id: string } }>('/_web/ai/skills/:id/reimport', async (request, reply) => {
    const result = mgr.reimportSkill(request.params.id)
    if (!result.success) return reply.code(400).send(result)
    return result
  })
}
