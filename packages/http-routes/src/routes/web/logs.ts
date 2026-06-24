import type { FastifyInstance } from 'fastify'
import { appLogger } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'

interface LogReportBody {
  level?: 'error' | 'warn'
  message: string
  stack?: string
  url?: string
}

/**
 * Front-end error report sink. The browser can't write files, so uncaught
 * front-end errors are POSTed here and appended to logs/app.log (scope 'web').
 */
export function registerLogRoutes(server: FastifyInstance, _ctx: HttpRouteContext): void {
  server.post<{ Body: LogReportBody }>('/_web/logs/report', async (req, reply) => {
    const { level, message, stack, url } = req.body ?? ({} as LogReportBody)
    if (!message) return reply.code(400).send({ error: 'message required' })

    const detail = [url ? `url=${url}` : null, stack ? `\n${stack}` : null].filter(Boolean).join(' ')
    if (level === 'warn') appLogger.warn('web', message, detail || undefined)
    else appLogger.error('web', message, detail || undefined)
    return { ok: true }
  })
}
