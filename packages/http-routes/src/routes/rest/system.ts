/**
 * ChatLab HTTP API — System routes
 *
 * GET /api/v1/status   Service status
 * GET /api/v1/schema   ChatLab Format JSON Schema
 */

import type { FastifyInstance } from 'fastify'
import { successResponse } from '../../errors'

export interface SystemRouteContext {
  getVersion: () => string
  countSessions: () => number | Promise<number>
}

export function registerSystemRoutes(server: FastifyInstance, ctx: SystemRouteContext): void {
  server.get('/api/v1/status', async () => {
    let sessionCount = 0
    try {
      sessionCount = await ctx.countSessions()
    } catch {
      // ignore
    }

    return successResponse({
      name: 'ChatLab API',
      version: ctx.getVersion(),
      uptime: Math.floor(process.uptime()),
      sessionCount,
    })
  })

  server.get('/api/v1/schema', async () => {
    return successResponse({
      format: 'ChatLab Format',
      version: '0.0.2',
      spec: {
        chatlab: {
          type: 'object',
          required: ['version'],
          properties: {
            version: { type: 'string' },
            exportedAt: { type: 'number' },
            generator: { type: 'string' },
          },
        },
        meta: {
          type: 'object',
          required: ['name', 'platform', 'type'],
          properties: {
            name: { type: 'string' },
            platform: {
              type: 'string',
              enum: ['qq', 'wechat', 'telegram', 'discord', 'line', 'whatsapp', 'instagram', 'unknown'],
            },
            type: { type: 'string', enum: ['group', 'private'] },
            groupId: { type: 'string' },
          },
        },
        members: {
          type: 'array',
          items: {
            type: 'object',
            required: ['platformId', 'accountName'],
            properties: {
              platformId: { type: 'string' },
              accountName: { type: 'string' },
              groupNickname: { type: 'string' },
              avatar: { type: 'string' },
            },
          },
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sender', 'timestamp', 'type'],
            properties: {
              platformMessageId: { type: 'string' },
              sender: { type: 'string' },
              accountName: { type: 'string' },
              groupNickname: { type: 'string' },
              timestamp: { type: 'number' },
              type: { type: 'number' },
              content: { type: ['string', 'null'] },
              replyToMessageId: { type: 'string' },
            },
          },
        },
      },
    })
  })
}
