import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

const hmacKey = randomBytes(32)

function safeTokenCompare(a: string, b: string): boolean {
  const hashA = createHmac('sha256', hmacKey).update(a).digest()
  const hashB = createHmac('sha256', hmacKey).update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

/** All internal routes require the per-process bearer token. */
export function createInternalAuthHook(token: string) {
  return async function internalAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.method === 'OPTIONS') return

    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } })
      return
    }

    const provided = authHeader.slice(7)
    if (!safeTokenCompare(provided, token)) {
      reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
    }
  }
}
