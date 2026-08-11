import type { FastifyInstance } from 'fastify'
import { createTimeInvestmentService, PreferencesManager } from '@openchatlab/node-runtime'
import type { RuntimeRouteContext } from '../../context/runtime'
import type { ServiceRouteContext } from '../../context/services'

interface TimeInvestmentQuery {
  mode?: string
  year?: string
  days?: string
  acceptStale?: string
}

type TimeInvestmentRouteContext = Pick<
  RuntimeRouteContext,
  'sessionAdapter' | 'pathProvider' | 'runtimeIdentity' | 'nativeBinding'
> &
  Pick<ServiceRouteContext, 'timeInvestmentService' | 'preferencesManager'>

export function registerTimeInvestmentRoutes(server: FastifyInstance, ctx: TimeInvestmentRouteContext): void {
  let preferences = ctx.preferencesManager
  const getExcludedSessionIds = () => {
    preferences ??= new PreferencesManager(ctx.pathProvider.getSystemDir())
    return preferences.load().ownerExcludedSessionIds
  }
  const service =
    ctx.timeInvestmentService ??
    createTimeInvestmentService({
      adapter: ctx.sessionAdapter,
      pathProvider: ctx.pathProvider,
      runtimeIdentity: ctx.runtimeIdentity,
      nativeBinding: ctx.nativeBinding,
      getExcludedSessionIds,
    })
  server.addHook('onClose', () => service.close())

  server.get<{ Querystring: TimeInvestmentQuery }>('/_web/global-insight/time-investment', async (request) =>
    service.getTimeInvestment({
      ...parseRange(request.query),
      acceptStale: isTruthy(request.query.acceptStale),
    })
  )

  server.post<{ Querystring: TimeInvestmentQuery }>('/_web/global-insight/time-investment/recompute', async (request) =>
    service.startRecompute(parseRange(request.query))
  )
}

function parseRange(query: TimeInvestmentQuery) {
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
