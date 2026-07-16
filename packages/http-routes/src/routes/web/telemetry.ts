import type { FastifyInstance } from 'fastify'
import type { AnalyticsService } from '@openchatlab/node-runtime'

interface TelemetryRouteContext {
  analyticsService?: Pick<AnalyticsService, 'getEnabled' | 'setEnabled' | 'trackDailyActive' | 'track'>
}

export function registerTelemetryRoutes(server: FastifyInstance, ctx: TelemetryRouteContext): void {
  server.get('/_web/telemetry/enabled', async () => {
    return { enabled: ctx.analyticsService?.getEnabled() ?? false }
  })

  server.post<{ Body: { enabled?: boolean } }>('/_web/telemetry/enabled', async (req) => {
    if (!ctx.analyticsService || typeof req.body?.enabled !== 'boolean') return { success: false }
    ctx.analyticsService.setEnabled(req.body.enabled)
    return { success: true }
  })

  server.post<{ Body: { eventName: string; properties?: Record<string, string | number> } }>(
    '/_web/telemetry/track',
    async (req, reply) => {
      if (!ctx.analyticsService) return { ok: true }
      const { eventName, properties } = req.body ?? {}
      if (!eventName) return reply.code(400).send({ error: 'eventName required' })
      if (eventName === 'app_active') {
        await ctx.analyticsService.trackDailyActive(properties)
      } else {
        await ctx.analyticsService.track(eventName, properties)
      }
      return { ok: true }
    }
  )
}
