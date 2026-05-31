import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../../context'
import { executeSql, getSchemaDetailed } from '@openchatlab/core'

export function registerSqlRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  const { sessionAdapter: adapter } = ctx

  server.post<{ Params: { id: string }; Body: { sql: string } }>('/_web/sessions/:id/sql', async (request, reply) => {
    const db = adapter.ensureReadonly(request.params.id)
    const { sql } = request.body || {}
    if (!sql || typeof sql !== 'string') {
      return reply.code(400).send({ error: 'Missing sql parameter' })
    }
    try {
      return executeSql(db, sql, { timing: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'SQL execution error'
      return reply.code(400).send({ error: message })
    }
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/schema', async (request) => {
    const db = adapter.ensureReadonly(request.params.id)
    return getSchemaDetailed(db)
  })

  server.post<{
    Params: { id: string }
    Body: { sql: string; params?: unknown[] | Record<string, unknown> }
  }>('/_web/sessions/:id/query', async (request) => {
    const db = adapter.ensureReadonly(request.params.id)
    const { sql, params = [] } = request.body as { sql: string; params?: unknown[] | Record<string, unknown> }

    if (!sql || typeof sql !== 'string') {
      throw Object.assign(new Error('Missing or invalid "sql" field'), { statusCode: 400 })
    }

    const stmt = db.prepare(sql.trim())

    if (!stmt.readonly) {
      throw Object.assign(new Error('Only READ-ONLY statements are allowed'), { statusCode: 403 })
    }

    if (Array.isArray(params)) {
      return stmt.all(...params)
    }
    return stmt.all(params)
  })
}
