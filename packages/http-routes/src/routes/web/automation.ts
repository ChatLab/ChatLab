import type { FastifyInstance } from 'fastify'
import type { AutomationRouteHostContext } from '../../context/automation'

function requireAutomation(ctx: AutomationRouteHostContext) {
  return ctx.automation ?? null
}

function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`
  if (url && !url.endsWith('/api/v1')) {
    url = url.replace(/\/api\/v1$/, '') + '/api/v1'
  }
  return url
}

function buildRemoteSessionsUrl(
  baseUrl: string,
  query: { keyword?: string; limit?: string | number; cursor?: string } = {}
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('format', 'chatlab')
  if (query.keyword?.trim()) searchParams.set('keyword', query.keyword.trim())
  if (query.limit && Number(query.limit) > 0) searchParams.set('limit', String(query.limit))
  if (query.cursor) searchParams.set('cursor', query.cursor)
  return `${baseUrl}/sessions?${searchParams.toString()}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function parseRemoteSessionsResponse(body: string): {
  sessions: unknown[]
  page?: { hasMore: boolean; nextCursor?: string }
} {
  const parsed = JSON.parse(body)

  let sessions: unknown[]
  let pageSource: Record<string, unknown> | undefined

  if (Array.isArray(parsed)) {
    sessions = parsed
  } else {
    const record = asRecord(parsed)
    const data = asRecord(record?.data)
    const sessionsSource = record?.sessions ?? data?.sessions ?? record?.data
    sessions = Array.isArray(sessionsSource) ? sessionsSource : []
    pageSource = asRecord(record?.page) ?? asRecord(data?.page)
  }

  return {
    sessions,
    page:
      pageSource && typeof pageSource === 'object'
        ? {
            hasMore: Boolean(pageSource.hasMore),
            nextCursor: typeof pageSource.nextCursor === 'string' ? pageSource.nextCursor : undefined,
          }
        : undefined,
  }
}

export function registerAutomationRoutes(server: FastifyInstance, ctx: AutomationRouteHostContext): void {
  server.get('/_web/automation/config', async (_request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation?.serverInfo) return reply.code(404).send({ error: 'Automation is not enabled' })
    return {
      enabled: true,
      port: automation.serverInfo.port,
      token: automation.serverInfo.token,
      host: automation.serverInfo.host,
    }
  })

  server.get('/_web/automation/data-sources', async (_request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    return automation.dsManager.loadAll()
  })

  server.post<{
    Body: { name?: string; baseUrl: string; token: string; intervalMinutes: number; pullLimit?: number }
  }>('/_web/automation/data-sources', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    const ds = automation.dsManager.add(request.body)
    automation.reloadTimer?.((ds as { id: string }).id)
    return ds
  })

  server.patch<{
    Params: { id: string }
    Body: {
      name?: string
      baseUrl?: string
      token?: string
      intervalMinutes?: number
      pullLimit?: number
      enabled?: boolean
    }
  }>('/_web/automation/data-sources/:id', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    const ds = automation.dsManager.update(request.params.id, request.body)
    if (!ds) return reply.code(404).send({ error: 'Data source not found' })
    automation.reloadTimer?.((ds as { id: string }).id)
    return ds
  })

  server.delete<{ Params: { id: string } }>('/_web/automation/data-sources/:id', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    automation.stopTimer?.(request.params.id)
    const ok = automation.dsManager.delete(request.params.id)
    if (!ok) return reply.code(404).send({ error: 'Data source not found' })
    return { success: true }
  })

  server.post<{
    Params: { id: string }
    Body: { sessions: Array<{ name: string; remoteSessionId: string }> }
  }>('/_web/automation/data-sources/:id/sessions', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    const added = automation.dsManager.addSessions(request.params.id, request.body.sessions)
    if (added.length === 0 && !automation.dsManager.get(request.params.id)) {
      return reply.code(404).send({ error: 'Data source not found' })
    }
    automation.reloadTimer?.(request.params.id, true)
    for (const sess of added as Array<{ id: string }>) {
      void automation.pullEngine.triggerPull(request.params.id, sess.id).catch(() => undefined)
    }
    return added
  })

  server.delete<{
    Params: { id: string; sessId: string }
    Querystring: { deleteData?: string }
  }>('/_web/automation/data-sources/:id/sessions/:sessId', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    const removed = automation.dsManager.removeSession(request.params.id, request.params.sessId)
    if (!removed) return reply.code(404).send({ error: 'Session not found' })
    automation.reloadTimer?.(request.params.id)
    if (request.query.deleteData === 'true' && removed.targetSessionId) {
      automation.deleteSessionData?.(removed.targetSessionId)
    }
    return { success: true }
  })

  server.post<{ Params: { id: string }; Body: { sessionId?: string } }>(
    '/_web/automation/data-sources/:id/pull',
    async (request, reply) => {
      const automation = requireAutomation(ctx)
      if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
      return automation.pullEngine.triggerPull(request.params.id, request.body?.sessionId)
    }
  )

  server.post<{ Params: { id: string } }>('/_web/automation/data-sources/:id/pull-all', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    return automation.pullEngine.triggerPullAll(request.params.id)
  })

  server.get('/_web/automation/sync-progress', async (_request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })
    return automation.pullEngine.getProgress()
  })

  server.get<{
    Querystring: { baseUrl: string; token?: string; keyword?: string; limit?: string; cursor?: string }
  }>('/_web/automation/remote-sessions', async (request, reply) => {
    const automation = requireAutomation(ctx)
    if (!automation) return reply.code(404).send({ error: 'Automation is not enabled' })

    const { baseUrl, token, keyword, limit, cursor } = request.query
    if (!baseUrl) return reply.code(400).send({ error: 'baseUrl is required' })

    const url = buildRemoteSessionsUrl(normalizeBaseUrl(baseUrl), { keyword, limit, cursor })
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) throw new Error(`Remote server returned HTTP ${resp.status}`)
      const body = await resp.text()
      return parseRemoteSessionsResponse(body)
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Failed to fetch remote sessions' })
    }
  })
}
