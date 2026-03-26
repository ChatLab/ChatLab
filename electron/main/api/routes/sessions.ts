/**
 * ChatLab API — 会话与导出路由
 */

import type { FastifyInstance } from 'fastify'
import * as worker from '../../worker/workerManager'
import { successResponse, sessionNotFound, exportTooLarge, sqlExecutionError, ApiError, errorResponse } from '../errors'

const EXPORT_MESSAGE_LIMIT = 100_000

async function ensureSession(sessionId: string) {
  const session = await worker.getSession(sessionId)
  if (!session) throw sessionNotFound(sessionId)
  return session
}

export function registerSessionRoutes(server: FastifyInstance): void {
  // GET /api/v1/sessions — 会话列表
  server.get('/api/v1/sessions', async () => {
    const sessions = await worker.getAllSessions()
    return successResponse(sessions)
  })

  // GET /api/v1/sessions/:id — 单个会话详情
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id', async (request) => {
    const session = await ensureSession(request.params.id)
    return successResponse(session)
  })

  // GET /api/v1/sessions/:id/messages — 查询消息（分页）
  server.get<{
    Params: { id: string }
    Querystring: {
      page?: string
      limit?: string
      startTime?: string
      endTime?: string
      keyword?: string
      senderId?: string
      type?: string
    }
  }>('/api/v1/sessions/:id/messages', async (request) => {
    const { id } = request.params
    await ensureSession(id)

    const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1)
    const limit = Math.min(1000, Math.max(1, parseInt(request.query.limit || '100', 10) || 100))
    const offset = (page - 1) * limit

    const { startTime, endTime, keyword, senderId } = request.query

    const filter: any = {}
    if (startTime) filter.startTs = parseInt(startTime, 10)
    if (endTime) filter.endTs = parseInt(endTime, 10)
    const hasFilter = filter.startTs || filter.endTs

    const keywords = keyword ? [keyword] : []
    const senderIdNum = senderId ? parseInt(senderId, 10) : undefined

    const result = await worker.searchMessages(
      id,
      keywords,
      hasFilter ? filter : undefined,
      limit,
      offset,
      senderIdNum
    )

    return successResponse(
      {
        messages: result.messages,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      }
    )
  })

  // GET /api/v1/sessions/:id/members — 成员列表
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/members', async (request) => {
    await ensureSession(request.params.id)
    const members = await worker.getMembers(request.params.id)
    return successResponse(members)
  })

  // GET /api/v1/sessions/:id/stats/overview — 概览统计
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/stats/overview', async (request) => {
    const { id } = request.params
    const session = await ensureSession(id)

    const [timeRange, memberActivity, typeDistribution] = await Promise.all([
      worker.getTimeRange(id),
      worker.getMemberActivity(id),
      worker.getMessageTypeDistribution(id),
    ])

    const typeMap: Record<string, number> = {}
    for (const item of typeDistribution) {
      typeMap[String(item.type)] = item.count
    }

    const topMembers = memberActivity.slice(0, 10).map((m: any) => ({
      platformId: m.platformId,
      name: m.name,
      messageCount: m.messageCount,
      percentage: m.percentage,
    }))

    return successResponse({
      messageCount: session.messageCount,
      memberCount: session.memberCount,
      timeRange: timeRange || { start: 0, end: 0 },
      messageTypeDistribution: typeMap,
      topMembers,
    })
  })

  // POST /api/v1/sessions/:id/sql — 执行 SQL（只读）
  server.post<{ Params: { id: string }; Body: { sql: string } }>(
    '/api/v1/sessions/:id/sql',
    async (request, reply) => {
      const { id } = request.params
      await ensureSession(id)

      const { sql } = request.body || {}
      if (!sql || typeof sql !== 'string') {
        const err = sqlExecutionError('缺少 sql 参数')
        return reply.code(err.statusCode).send(errorResponse(err))
      }

      try {
        const result = await worker.executeRawSQL(id, sql)
        return successResponse(result)
      } catch (err: any) {
        const message = err.message || 'SQL 执行错误'
        if (message.includes('SELECT') || message.includes('只读') || message.includes('readonly')) {
          const apiErr = new ApiError('SQL_READONLY_VIOLATION' as any, message)
          apiErr.statusCode = 400
          return reply.code(400).send(errorResponse(apiErr))
        }
        const apiErr = sqlExecutionError(message)
        return reply.code(apiErr.statusCode).send(errorResponse(apiErr))
      }
    }
  )

  // GET /api/v1/sessions/:id/export — 导出 ChatLab Format JSON
  server.get<{ Params: { id: string } }>('/api/v1/sessions/:id/export', async (request, reply) => {
    const { id } = request.params
    const session = await ensureSession(id)

    if (session.messageCount > EXPORT_MESSAGE_LIMIT) {
      const err = exportTooLarge(session.messageCount, EXPORT_MESSAGE_LIMIT)
      return reply.code(err.statusCode).send(errorResponse(err))
    }

    const [members, messagesResult] = await Promise.all([
      worker.getMembers(id),
      worker.searchMessages(id, [], undefined, EXPORT_MESSAGE_LIMIT, 0),
    ])

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
      members: members.map((m: any) => ({
        platformId: m.platformId,
        accountName: m.accountName || m.platformId,
        groupNickname: m.groupNickname || undefined,
        aliases: Array.isArray(m.aliases) && m.aliases.length > 0 ? m.aliases : undefined,
      })),
      messages: messagesResult.messages.map((msg: any) => ({
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
