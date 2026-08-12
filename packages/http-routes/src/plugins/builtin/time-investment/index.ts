import { createTimeInvestmentService, PreferencesManager } from '@openchatlab/node-runtime'
import { TIME_INVESTMENT_PLUGIN_ID } from '@openchatlab/shared-types'
import type { NodePluginDescriptor } from '../../node'

interface TimeInvestmentQuery {
  mode?: string
  year?: string
  days?: string
  acceptStale?: string
}

export const timeInvestmentNodePlugin = {
  id: TIME_INVESTMENT_PLUGIN_ID,
  registerHttpRoutes(server, context) {
    let preferences = context.preferencesManager
    const getExcludedSessionIds = () => {
      preferences ??= new PreferencesManager(context.pathProvider.getSystemDir())
      return preferences.load().ownerExcludedSessionIds
    }
    const service =
      context.timeInvestmentService ??
      createTimeInvestmentService({
        adapter: context.sessionAdapter,
        pathProvider: context.pathProvider,
        runtimeIdentity: context.runtimeIdentity,
        nativeBinding: context.nativeBinding,
        getExcludedSessionIds,
      })
    server.addHook('onClose', () => service.close())

    server.get<{ Querystring: TimeInvestmentQuery }>('/_web/global-insight/time-investment', async (request) =>
      service.getTimeInvestment({
        ...parseRange(request.query),
        acceptStale: isTruthy(request.query.acceptStale),
      })
    )

    server.post<{ Querystring: TimeInvestmentQuery }>(
      '/_web/global-insight/time-investment/recompute',
      async (request) => service.startRecompute(parseRange(request.query))
    )
  },
} satisfies NodePluginDescriptor

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
