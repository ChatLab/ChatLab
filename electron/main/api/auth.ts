/**
 * ChatLab API — Bearer Token authentication hook
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual } from 'crypto'
import { loadConfig } from './config'
import { unauthorized, errorResponse } from './errors'

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = unauthorized()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const token = authHeader.slice(7)
  const config = loadConfig()

  if (!config.token || !safeTokenCompare(token, config.token)) {
    const err = unauthorized()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }
}
