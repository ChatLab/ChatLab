/**
 * ChatLab API Bearer Token 认证中间件
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { loadConfig } from './config'
import { unauthorized, errorResponse } from './errors'

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = unauthorized()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const token = authHeader.slice(7)
  const config = loadConfig()

  if (!config.token || token !== config.token) {
    const err = unauthorized()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }
}
