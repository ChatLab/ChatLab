import * as fs from 'fs'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { createJiebaNlpProvider } from '@openchatlab/node-runtime'
import {
  getTimeRange,
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMessageTypeStats,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageLengthDistribution,
  getTextStats,
  getLongMessageCount,
  getMemberMonthlyTrend,
  getTextLengthPercentiles,
  getRelationshipStats,
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
  getLanguagePreferenceAnalysis,
  getDragonKingAnalysis,
  getDivingAnalysis,
  getCheckInAnalysis,
  getMemeBattleAnalysis,
  getNightOwlAnalysis,
  getRepeatAnalysis,
} from '@openchatlab/core'
import type { ClusterGraphOptions } from '@openchatlab/core'
import { parseTimeFilter } from './time-filter'
import { withAnalyticsCache } from './analytics-cache'

type FilteredQuery = { startTs?: string; endTs?: string; memberId?: string }

export function registerAnalyticsRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const { sessionAdapter: adapter } = ctx

  /** Cache-first wrapper bound to this context; `params` must capture all inputs that affect the result. */
  const cached = <T>(
    name: string,
    sessionId: string,
    params: Record<string, unknown>,
    compute: () => T,
    options?: { dailyInvalidate?: boolean; extraVersion?: string }
  ): T => withAnalyticsCache(ctx, sessionId, `analytics.${name}`, params, compute, options)

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/years', async (request) => {
    const db = adapter.ensureReadonly(request.params.id)
    return getAvailableYears(db)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/time-range', async (request) => {
    const db = adapter.ensureReadonly(request.params.id)
    return getTimeRange(db)
  })

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/member-activity',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('member-activity', id, { ...filter }, () => getMemberActivity(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/hourly',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('hourly', id, { ...filter }, () => getHourlyActivity(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/daily',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('daily', id, { ...filter }, () => getDailyActivity(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/weekday',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('weekday', id, { ...filter }, () => getWeekdayActivity(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/message-types',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('message-types', id, { ...filter }, () => getMessageTypeStats(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/relationship',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('relationship', id, { ...filter }, () => getRelationshipStats(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/catchphrase',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('catchphrase', id, { ...filter }, () => getCatchphraseAnalysis(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/mention',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('mention', id, { ...filter }, () => getMentionAnalysis(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/mention-graph',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('mention-graph', id, { ...filter }, () => getMentionGraph(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/laugh',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('laugh', id, { ...filter }, () => getLaughAnalysis(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{
    Params: { id: string }
    Querystring: FilteredQuery & { topEdges?: string; lookAhead?: string; decaySeconds?: string }
  }>('/_web/sessions/:id/analytics/cluster', async (request) => {
    const id = request.params.id
    const filter = parseTimeFilter(request.query)
    // 仅收集显式传入的参数，避免 undefined 覆盖核心算法默认值
    const options: ClusterGraphOptions = {}
    if (request.query.topEdges) options.topEdges = parseInt(request.query.topEdges, 10)
    if (request.query.lookAhead) options.lookAhead = parseInt(request.query.lookAhead, 10)
    if (request.query.decaySeconds) options.decaySeconds = parseInt(request.query.decaySeconds, 10)
    const hasOptions = Object.keys(options).length > 0
    return cached('cluster', id, { ...filter, ...options }, () =>
      getClusterGraph(adapter.ensureReadonly(id), filter, hasOptions ? options : undefined)
    )
  })

  server.get<{ Params: { id: string }; Querystring: FilteredQuery & { locale?: string } }>(
    '/_web/sessions/:id/analytics/language-preference',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      const locale = request.query.locale || 'zh-CN'
      const zhDictPath = path.join(ctx.pathProvider.getSystemDir(), 'nlp', 'zh-CN.dict')
      let zhDictVersion: string
      try {
        const st = fs.statSync(zhDictPath)
        zhDictVersion = `${Math.floor(st.mtimeMs)}:${st.size}`
      } catch {
        zhDictVersion = '-'
      }
      return cached(
        'language-preference',
        id,
        { ...filter, locale },
        () =>
          getLanguagePreferenceAnalysis(adapter.ensureReadonly(id), {
            locale,
            timeFilter: filter,
            nlpProvider: createJiebaNlpProvider(),
          }),
        { extraVersion: `dict:${zhDictVersion}` }
      )
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/monthly-activity',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('monthly-activity', id, { ...filter }, () => getMonthlyActivity(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/yearly-activity',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('yearly-activity', id, { ...filter }, () => getYearlyActivity(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/message-length-distribution',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('message-length-distribution', id, { ...filter }, () =>
        getMessageLengthDistribution(adapter.ensureReadonly(id), filter)
      )
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/text-stats',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('text-stats', id, { ...filter }, () => getTextStats(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery & { minLength?: string } }>(
    '/_web/sessions/:id/analytics/long-message-count',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      const minLength = request.query.minLength ? parseInt(request.query.minLength, 10) : undefined
      return cached('long-message-count', id, { ...filter, minLength }, () =>
        getLongMessageCount(adapter.ensureReadonly(id), filter, minLength)
      )
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/member-monthly-trend',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('member-monthly-trend', id, { ...filter }, () =>
        getMemberMonthlyTrend(adapter.ensureReadonly(id), filter)
      )
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/text-length-percentiles',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('text-length-percentiles', id, { ...filter }, () =>
        getTextLengthPercentiles(adapter.ensureReadonly(id), filter)
      )
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/dragon-king',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('dragon-king', id, { ...filter }, () => getDragonKingAnalysis(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/diving',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('diving', id, { ...filter }, () => getDivingAnalysis(adapter.ensureReadonly(id), filter), {
        dailyInvalidate: true,
      })
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/check-in',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('check-in', id, { ...filter }, () => getCheckInAnalysis(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/meme-battle',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('meme-battle', id, { ...filter }, () => getMemeBattleAnalysis(adapter.ensureReadonly(id), filter))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/night-owl',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('night-owl', id, { ...filter }, () => getNightOwlAnalysis(adapter.ensureReadonly(id), filter), {
        dailyInvalidate: true,
      })
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/repeat',
    async (request) => {
      const id = request.params.id
      const filter = parseTimeFilter(request.query)
      return cached('repeat', id, { ...filter }, () => getRepeatAnalysis(adapter.ensureReadonly(id), filter))
    }
  )
}
