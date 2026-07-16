/**
 * ChatLab HTTP API — REST Session routes (/api/v1/sessions/*)
 *
 * Public REST API for external tools, scripts, and integrations.
 * Uses an injected provider so Electron can keep database work in its Worker.
 */

import type { FastifyInstance } from 'fastify'
import {
  successResponse,
  errorResponse,
  sessionNotFound,
  exportTooLarge,
  sqlExecutionError,
  ApiError,
} from '../../errors'
import type { RestSessionProvider } from './session-provider'

const EXPORT_MESSAGE_LIMIT = 100_000

export function registerRestSessionRoutes(server: FastifyInstance, provider: RestSessionProvider): void {
  server.get('/api/v1/sessions', async () => {
    return successResponse(await provider.listSessions())
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request) => {
    const session = await provider.getSession(request.params.id)
    if (!session) throw sessionNotFound(request.params.id)
    return successResponse(session)
  })

  server.get<{
    Params: { id: string }
    Querystring: {
      page?: string
      limit?: string
      startTime?: string
      endTime?: string
      keyword?: string
      senderId?: string
    }
  }>('/api/v1/sessions/:id/messages', async (request) => {
    const { id } = request.params

    const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1)
    const limit = Math.min(1000, Math.max(1, parseInt(request.query.limit || '100', 10) || 100))
    const offset = (page - 1) * limit

    const { startTime, endTime, keyword, senderId } = request.query

    const result = await provider.queryMessages(id, {
      keyword: keyword || undefined,
      startTime: startTime ? parseInt(startTime, 10) : undefined,
      endTime: endTime ? parseInt(endTime, 10) : undefined,
      senderId: senderId ? parseInt(senderId, 10) : undefined,
      limit,
      offset,
    })
    if (!result) throw sessionNotFound(id)

    return successResponse({
      messages: result.messages,
      total: result.total,
      page,
      limit,
      totalPages: result.totalPages ?? Math.ceil(result.total / limit),
    })
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/members', async (request) => {
    const members = await provider.getMembers(request.params.id)
    if (!members) throw sessionNotFound(request.params.id)
    return successResponse(members)
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/stats/overview', async (request) => {
    const overview = await provider.getOverview(request.params.id)
    if (!overview) throw sessionNotFound(request.params.id)
    return successResponse(overview)
  })

  server.post<{ Params: { id: string }; Body: { sql: string } }>('/api/v1/sessions/:id/sql', async (request, reply) => {
    const { id } = request.params

    const { sql } = request.body || {}
    if (!sql || typeof sql !== 'string') {
      const err = sqlExecutionError('Missing sql parameter')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    try {
      const result = await provider.executeReadonlySql(id, sql)
      if (result === null) {
        const err = sessionNotFound(id)
        return reply.code(err.statusCode).send(errorResponse(err))
      }
      return successResponse(result)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'SQL execution error'
      if (message.includes('SELECT') || message.includes('只读') || message.includes('readonly')) {
        const apiErr = new ApiError('SQL_READONLY_VIOLATION' as ApiError['code'], message)
        apiErr.statusCode = 400
        return reply.code(400).send(errorResponse(apiErr))
      }
      const apiErr = sqlExecutionError(message)
      return reply.code(apiErr.statusCode).send(errorResponse(apiErr))
    }
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/export', async (request, reply) => {
    const { id } = request.params
    const session = await provider.getSession(id)
    if (!session) throw sessionNotFound(id)

    if (session.messageCount > EXPORT_MESSAGE_LIMIT) {
      const err = exportTooLarge(session.messageCount, EXPORT_MESSAGE_LIMIT)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const exportData = await provider.getExportData(id, EXPORT_MESSAGE_LIMIT)
    if (!exportData) throw sessionNotFound(id)

    const chatLabFormat = {
      chatlab: {
        version: '0.0.2',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab API',
      },
      meta: {
        name: session.name,
        platform: session.platform,
        type: session.type,
        groupId: session.groupId || undefined,
      },
      members: exportData.members.map((m) => ({
        platformId: m.platformId,
        accountName: m.accountName || m.platformId,
        groupNickname: m.groupNickname || undefined,
        aliases: Array.isArray(m.aliases) && m.aliases.length > 0 ? m.aliases : undefined,
      })),
      messages: exportData.messages.map((msg) => ({
        sender: msg.senderPlatformId,
        accountName: msg.senderName || undefined,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content || null,
      })),
    }

    return successResponse(chatLabFormat)
  })
}
