import { ANNUAL_SUMMARY_PLUGIN_ID } from '@openchatlab/shared-types'
import { createGlobalInsightService, PreferencesManager } from '@openchatlab/node-runtime'
import type { NodePluginDescriptor } from '../../node'

interface AnnualSummaryQuery {
  mode?: string
  year?: string
  days?: string
  acceptStale?: string
}

export const annualSummaryNodePlugin = {
  id: ANNUAL_SUMMARY_PLUGIN_ID,
  registerHttpRoutes(server, context) {
    let preferences = context.preferencesManager
    const getExcludedSessionIds = () => {
      preferences ??= new PreferencesManager(context.pathProvider.getSystemDir())
      return preferences.load().ownerExcludedSessionIds
    }
    const service =
      context.globalInsightService ??
      createGlobalInsightService({
        adapter: context.sessionAdapter,
        pathProvider: context.pathProvider,
        runtimeIdentity: context.runtimeIdentity,
        nativeBinding: context.nativeBinding,
        getExcludedSessionIds,
      })

    server.addHook('onClose', () => service.close())
    server.get<{ Querystring: AnnualSummaryQuery }>('/_web/global-insight/annual-summary', async (request) =>
      service.getAnnualSummary({
        ...parseRange(request.query),
        acceptStale: isTruthy(request.query.acceptStale),
      })
    )
    server.post<{ Querystring: AnnualSummaryQuery }>('/_web/global-insight/annual-summary/recompute', async (request) =>
      service.startRecompute(parseRange(request.query))
    )
  },
} satisfies NodePluginDescriptor

function parseRange(query: AnnualSummaryQuery) {
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
