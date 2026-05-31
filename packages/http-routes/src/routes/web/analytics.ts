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
  getRelationshipStats,
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
  getLanguagePreferenceAnalysis,
} from '@openchatlab/core'
import { parseTimeFilter } from '../../helpers'

type FilteredQuery = { startTs?: string; endTs?: string; memberId?: string }

export function registerAnalyticsRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const { sessionAdapter: adapter } = ctx

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
      const db = adapter.ensureReadonly(request.params.id)
      return getMemberActivity(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/hourly',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getHourlyActivity(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/daily',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getDailyActivity(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/weekday',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getWeekdayActivity(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/stats/message-types',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getMessageTypeStats(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/relationship',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getRelationshipStats(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/catchphrase',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getCatchphraseAnalysis(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/mention',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getMentionAnalysis(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/mention-graph',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getMentionGraph(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/laugh',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getLaughAnalysis(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery & { topEdges?: string } }>(
    '/_web/sessions/:id/analytics/cluster',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      const filter = parseTimeFilter(request.query)
      const topEdges = request.query.topEdges ? parseInt(request.query.topEdges, 10) : undefined
      return getClusterGraph(db, filter, topEdges ? { topEdges } : undefined)
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery & { locale?: string } }>(
    '/_web/sessions/:id/analytics/language-preference',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      const filter = parseTimeFilter(request.query)
      const locale = request.query.locale || 'zh-CN'
      const nlpProvider = createJiebaNlpProvider()
      return getLanguagePreferenceAnalysis(db, { locale, timeFilter: filter, nlpProvider })
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/monthly-activity',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getMonthlyActivity(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/yearly-activity',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getYearlyActivity(db, parseTimeFilter(request.query))
    }
  )

  server.get<{ Params: { id: string }; Querystring: FilteredQuery }>(
    '/_web/sessions/:id/analytics/message-length-distribution',
    async (request) => {
      const db = adapter.ensureReadonly(request.params.id)
      return getMessageLengthDistribution(db, parseTimeFilter(request.query))
    }
  )
}
