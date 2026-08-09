import type { FastifyInstance } from 'fastify'
import {
  assertValidTopicDayKey,
  createChatTopicModelClient,
  createChatTopicService,
  type ChatTopicService,
} from '@openchatlab/node-runtime'
import type { CreateChatTopicsRequest } from '@openchatlab/shared-types'
import type { AiRouteContext } from '../../context/ai'
import type { RuntimeRouteContext } from '../../context/runtime'

type ChatTopicRouteContext = Pick<RuntimeRouteContext, 'sessionAdapter' | 'pathProvider' | 'nativeBinding'> &
  Pick<AiRouteContext, 'llmConfigStore'>

export function registerAiChatTopicRoutes(server: FastifyInstance, ctx: ChatTopicRouteContext): void {
  let service: ChatTopicService | null = null
  const getService = () => {
    service ??= createChatTopicService({
      runtime: ctx.sessionAdapter,
      userDataDir: ctx.pathProvider.getUserDataDir(),
      nativeBinding: ctx.nativeBinding,
      getModelClient() {
        const config = ctx.llmConfigStore?.getFastModelConfig()
        return config ? createChatTopicModelClient(config) : null
      },
    })
    return service
  }

  server.addHook('onClose', async () => {
    service?.close()
  })

  server.post<{ Params: { id: string }; Body: CreateChatTopicsRequest }>(
    '/_web/sessions/:id/topics/preflight',
    async (request) => getService().preflight(request.params.id, requireCreateRequest(request.body))
  )

  server.post<{ Params: { id: string }; Body: CreateChatTopicsRequest }>(
    '/_web/sessions/:id/topics/runs',
    async (request, reply) => {
      const run = getService().start(request.params.id, requireCreateRequest(request.body))
      return reply.code(run.status === 'completed' ? 200 : 202).send(run)
    }
  )

  server.post<{
    Params: { id: string; dayKey: string }
    Body: { timezone: string; locale?: string }
  }>('/_web/sessions/:id/topics/days/:dayKey/generate', async (request, reply) => {
    const run = getService().generateDay(
      request.params.id,
      request.params.dayKey,
      requireTimezone(request.body?.timezone),
      request.body?.locale
    )
    return reply.code(run.status === 'completed' ? 200 : 202).send(run)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/topics/runs/latest', async (request) =>
    getService().getLatestRun(request.params.id)
  )

  server.get<{ Params: { id: string; runId: string } }>(
    '/_web/sessions/:id/topics/runs/:runId',
    async (request, reply) => {
      const run = getService().getRun(request.params.id, request.params.runId)
      return run ?? reply.code(404).send({ error: 'Chat topic run not found' })
    }
  )

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    server.post<{ Params: { id: string; runId: string } }>(
      `/_web/sessions/:id/topics/runs/:runId/${action}`,
      async (request) => getService()[action](request.params.id, request.params.runId)
    )
  }

  server.get<{
    Params: { id: string; dayKey: string }
    Querystring: { timezone: string }
  }>('/_web/sessions/:id/topics/days/:dayKey', async (request) =>
    getService().getDay(request.params.id, request.params.dayKey, requireTimezone(request.query.timezone))
  )

  server.delete<{ Params: { id: string; dayKey: string } }>(
    '/_web/sessions/:id/topics/days/:dayKey',
    async (request) => ({ success: getService().deleteDay(request.params.id, request.params.dayKey) })
  )
}

function requireCreateRequest(value: CreateChatTopicsRequest | undefined): CreateChatTopicsRequest {
  if (!value || !['today', 'year', 'custom', 'all'].includes(value.rangeKind)) {
    throw Object.assign(new Error('Invalid chat topic range'), { statusCode: 400 })
  }
  const timezone = requireTimezone(value.timezone)
  if (value.rangeKind === 'custom') {
    if (typeof value.startDay !== 'string' || value.startDay.trim() === '') {
      throw Object.assign(new Error('A start day is required for a custom topic range'), { statusCode: 400 })
    }
    assertValidTopicDayKey(value.startDay)
    return { ...value, timezone, startDay: value.startDay }
  }
  return { rangeKind: value.rangeKind, timezone, locale: value.locale }
}

function requireTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Object.assign(new Error('Timezone is required'), { statusCode: 400 })
  }
  return value
}
