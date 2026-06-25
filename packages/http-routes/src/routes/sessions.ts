/**
 * ChatLab HTTP API — REST Session routes (/api/v1/sessions/*)
 *
 * Public REST API for external tools, scripts, and integrations.
 * Uses DatabaseManager + @openchatlab/core for data access.
 */

import type { FastifyInstance } from 'fastify'
import type { HttpRouteContext } from '../context'
import {
  getSessionInfo,
  getSessionMeta,
  getSessionOverview,
  queryMessages,
  getMembers,
  getMembersDetailed,
  getMemberActivity,
  getMessageTypeStats,
  executeReadonlySql,
  getLastPlatformMessageId,
} from '@openchatlab/core'
import { successResponse, errorResponse, sessionNotFound, exportTooLarge, sqlExecutionError, ApiError } from '../errors'

const EXPORT_MESSAGE_LIMIT = 100_000

function ensureDb(ctx: HttpRouteContext, sessionId: string) {
  const db = ctx.dbManager.open(sessionId)
  if (!db) throw sessionNotFound(sessionId)
  return db
}

export function registerRestSessionRoutes(server: FastifyInstance, ctx: HttpRouteContext): void {
  server.get('/api/v1/sessions', async () => {
    const sessionIds = ctx.dbManager.listSessionIds()
    const sessions = sessionIds
      .map((id) => {
        const db = ctx.dbManager.open(id)
        if (!db) return null
        const info = getSessionInfo(db)
        if (!info) return null
        return {
          id,
          name: info.name,
          platform: info.platform,
          type: info.type,
          groupId: info.groupId || undefined,
          messageCount: info.messageCount,
          memberCount: info.memberCount,
          firstTimestamp: info.firstMessageTs,
          lastTimestamp: info.lastMessageTs,
        }
      })
      .filter(Boolean)
    return successResponse(sessions)
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request) => {
    const db = ensureDb(ctx, request.params.id)
    const info = getSessionInfo(db)
    if (!info) throw sessionNotFound(request.params.id)
    return successResponse({
      id: request.params.id,
      name: info.name,
      platform: info.platform,
      type: info.type,
      groupId: info.groupId || undefined,
      messageCount: info.messageCount,
      memberCount: info.memberCount,
      firstTimestamp: info.firstMessageTs,
      lastTimestamp: info.lastMessageTs,
      lastPlatformMessageId: getLastPlatformMessageId(db),
      importedAt: info.importedAt,
    })
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
    const db = ensureDb(ctx, id)

    const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1)
    const limit = Math.min(1000, Math.max(1, parseInt(request.query.limit || '100', 10) || 100))
    const offset = (page - 1) * limit

    const { startTime, endTime, keyword, senderId } = request.query

    const result = queryMessages(db, {
      keyword: keyword || undefined,
      startTs: startTime ? parseInt(startTime, 10) : undefined,
      endTs: endTime ? parseInt(endTime, 10) : undefined,
      senderId: senderId ? parseInt(senderId, 10) : undefined,
      limit,
      offset,
    })

    return successResponse({
      messages: result.messages,
      total: result.total,
      page,
      limit,
      totalPages: result.totalPages,
    })
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/members', async (request) => {
    const db = ensureDb(ctx, request.params.id)
    const members = getMembers(db)
    return successResponse(members)
  })

  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/stats/overview', async (request) => {
    const { id } = request.params
    const db = ensureDb(ctx, id)

    const overview = getSessionOverview(db)
    const memberActivity = getMemberActivity(db)
    const typeDistribution = getMessageTypeStats(db)

    const typeMap: Record<string, number> = {}
    for (const item of typeDistribution) {
      typeMap[String(item.type)] = item.count
    }

    const topMembers = memberActivity.slice(0, 10).map((m) => ({
      platformId: m.platformId,
      name: m.name,
      messageCount: m.messageCount,
      percentage: m.percentage,
    }))

    return successResponse({
      messageCount: overview.totalMessages,
      memberCount: overview.totalMembers,
      timeRange: {
        start: overview.firstMessageTs ?? 0,
        end: overview.lastMessageTs ?? 0,
      },
      messageTypeDistribution: typeMap,
      topMembers,
    })
  })

  server.post<{ Params: { id: string }; Body: { sql: string } }>('/api/v1/sessions/:id/sql', async (request, reply) => {
    const { id } = request.params
    const db = ensureDb(ctx, id)

    const { sql } = request.body || {}
    if (!sql || typeof sql !== 'string') {
      const err = sqlExecutionError('Missing sql parameter')
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    try {
      const result = executeReadonlySql(db, sql)
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
    const db = ensureDb(ctx, id)
    const meta = getSessionMeta(db)
    if (!meta) throw sessionNotFound(id)
    const overview = getSessionOverview(db)

    if (overview.totalMessages > EXPORT_MESSAGE_LIMIT) {
      const err = exportTooLarge(overview.totalMessages, EXPORT_MESSAGE_LIMIT)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const members = getMembersDetailed(db)
    const allMessages = queryMessages(db, { limit: EXPORT_MESSAGE_LIMIT, offset: 0 })

    const chatLabFormat = {
      chatlab: {
        version: '0.0.2',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab API',
      },
      meta: {
        name: meta.name,
        platform: meta.platform,
        type: meta.type,
        groupId: meta.groupId || undefined,
      },
      members: members.map((m) => ({
        platformId: m.platformId,
        accountName: m.accountName || m.platformId,
        groupNickname: m.groupNickname || undefined,
      })),
      messages: allMessages.messages.map((msg) => ({
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
