/**
 * ChatLab Internal Web API — /_web/automation/ routes
 *
 * Exposes sync engine functionality to the Web UI via HTTP endpoints.
 */

import type { FastifyInstance } from 'fastify'
import {
  buildRemoteSessionsUrl,
  parseRemoteSessionsResponse,
  normalizeBaseUrl,
  reloadTimer,
  stopTimer,
} from '@openchatlab/sync'
import type { SyncRouteContext } from './index'

export function registerAutomationRoutes(server: FastifyInstance, ctx: SyncRouteContext): void {
  const { dsManager, pullEngine, dbManager, serverInfo } = ctx

  // ==================== Config (read-only in CLI mode) ====================

  server.get('/_web/automation/config', async () => {
    return {
      enabled: true,
      port: serverInfo.port,
      token: serverInfo.token,
      host: serverInfo.host,
    }
  })

  // ==================== Data Sources ====================

  server.get('/_web/automation/data-sources', async () => {
    return dsManager.loadAll()
  })

  server.post<{
    Body: { name?: string; baseUrl: string; token: string; intervalMinutes: number; pullLimit?: number }
  }>('/_web/automation/data-sources', async (request) => {
    const ds = dsManager.add(request.body)
    reloadTimer(ds.id)
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
    const ds = dsManager.update(request.params.id, request.body)
    if (!ds) return reply.code(404).send({ error: 'Data source not found' })
    reloadTimer(ds.id)
    return ds
  })

  server.delete<{ Params: { id: string } }>('/_web/automation/data-sources/:id', async (request, reply) => {
    stopTimer(request.params.id)
    const ok = dsManager.delete(request.params.id)
    if (!ok) return reply.code(404).send({ error: 'Data source not found' })
    return { success: true }
  })

  // ==================== Import Sessions ====================

  server.post<{
    Params: { id: string }
    Body: { sessions: Array<{ name: string; remoteSessionId: string }> }
  }>('/_web/automation/data-sources/:id/sessions', async (request, reply) => {
    const added = dsManager.addSessions(request.params.id, request.body.sessions)
    if (added.length === 0 && !dsManager.get(request.params.id)) {
      return reply.code(404).send({ error: 'Data source not found' })
    }
    reloadTimer(request.params.id, true)
    for (const sess of added) {
      pullEngine.triggerPull(request.params.id, sess.id).catch(() => {})
    }
    return added
  })

  server.delete<{
    Params: { id: string; sessId: string }
    Querystring: { deleteData?: string }
  }>('/_web/automation/data-sources/:id/sessions/:sessId', async (request, reply) => {
    const removed = dsManager.removeSession(request.params.id, request.params.sessId)
    if (!removed) return reply.code(404).send({ error: 'Session not found' })
    reloadTimer(request.params.id)
    if (request.query.deleteData === 'true' && removed.targetSessionId) {
      dbManager.deleteSessionDatabaseFiles(removed.targetSessionId)
    }
    return { success: true }
  })

  // ==================== Pull / Sync ====================

  server.post<{ Params: { id: string }; Body: { sessionId?: string } }>(
    '/_web/automation/data-sources/:id/pull',
    async (request) => {
      return pullEngine.triggerPull(request.params.id, request.body?.sessionId)
    }
  )

  server.post<{ Params: { id: string } }>('/_web/automation/data-sources/:id/pull-all', async (request) => {
    return pullEngine.triggerPullAll(request.params.id)
  })

  // ==================== Sync Progress ====================

  server.get('/_web/automation/sync-progress', async () => {
    return pullEngine.getProgress()
  })

  // ==================== Remote Session Discovery ====================

  server.get<{
    Querystring: { baseUrl: string; token?: string; keyword?: string; limit?: string; cursor?: string }
  }>('/_web/automation/remote-sessions', async (request, reply) => {
    const { baseUrl, token, keyword, limit, cursor } = request.query
    if (!baseUrl) return reply.code(400).send({ error: 'baseUrl is required' })

    const normalizedUrl = normalizeBaseUrl(baseUrl)
    const url = buildRemoteSessionsUrl(normalizedUrl, {
      keyword,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    })

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) throw new Error(`Remote server returned HTTP ${resp.status}`)
      const body = await resp.text()
      return parseRemoteSessionsResponse(body)
    } catch (err: any) {
      return reply.code(502).send({ error: err.message || 'Failed to fetch remote sessions' })
    }
  })
}
