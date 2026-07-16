import type { FastifyInstance } from 'fastify'
import { createGlobalInsightService } from '@openchatlab/node-runtime'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'

interface GlobalInsightQuery {
  mode?: string
  year?: string
  days?: string
  acceptStale?: string
}

type GlobalInsightRouteContext = Pick<
  RuntimeRouteContext,
  'sessionAdapter' | 'pathProvider' | 'runtimeIdentity' | 'nativeBinding'
> &
  Pick<ServiceRouteContext, 'globalInsightService'>

export function registerGlobalInsightRoutes(server: FastifyInstance, ctx: GlobalInsightRouteContext): void {
  const service =
    ctx.globalInsightService ??
    createGlobalInsightService({
      adapter: ctx.sessionAdapter,
      pathProvider: ctx.pathProvider,
      runtimeIdentity: ctx.runtimeIdentity,
      nativeBinding: ctx.nativeBinding,
    })
  server.addHook('onClose', async () => service.close())

  server.get<{ Querystring: GlobalInsightQuery }>('/_web/global-insight/annual-summary', async (request) => {
    return service.getAnnualSummary({
      ...parseRange(request.query),
      acceptStale: isTruthy(request.query.acceptStale),
    })
  })

  server.post<{ Querystring: GlobalInsightQuery }>('/_web/global-insight/annual-summary/recompute', async (request) =>
    service.startRecompute(parseRange(request.query))
  )
}

function parseRange(query: GlobalInsightQuery) {
  const mode = query.mode === 'recent' ? ('recent' as const) : ('year' as const)
  return {
    mode,
    year: parseInteger(query.year),
    days: query.days === '365' ? (365 as const) : undefined,
  }
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}
