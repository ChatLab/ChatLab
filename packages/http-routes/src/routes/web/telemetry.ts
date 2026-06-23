import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'

export function registerTelemetryRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
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
