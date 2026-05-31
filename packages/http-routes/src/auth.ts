/**
 * ChatLab HTTP API — Bearer Token authentication hook
 *
 * Shared auth middleware for CLI Server and Electron Internal Server.
 * URL classification: /api/* always requires token, /_web/* conditionally,
 * static files and SPA fallback are public.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual, createHmac, randomBytes } from 'crypto'
import { unauthorized, errorResponse } from './errors'

let cachedToken: string | null = null
let requireAuthEnabled = false

export function setAuthToken(token: string): void {
  cachedToken = token
}

/**
 * When enabled, /_web/* routes also require Bearer token (same as /api/*).
 * Used for server/headless deployments where same-origin assumption doesn't hold.
 */
export function setRequireAuth(enabled: boolean): void {
  requireAuthEnabled = enabled
}

// Compare via HMAC digests (fixed 32-byte length) to avoid leaking token length
const hmacKey = randomBytes(32)

function safeTokenCompare(a: string, b: string): boolean {
  const hashA = createHmac('sha256', hmacKey).update(a).digest()
  const hashB = createHmac('sha256', hmacKey).update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!cachedToken) return

  const url = request.url

  if (url.startsWith('/api/')) {
    return requireBearerToken(request, reply)
  }

  if (url.startsWith('/_web/')) {
    if (requireAuthEnabled) return requireBearerToken(request, reply)
    return
  }

  // Static files and SPA fallback are public
}

function requireBearerToken(request: FastifyRequest, reply: FastifyReply): void {
  if (!cachedToken) return

  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = unauthorized()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }

  const token = authHeader.slice(7)

  if (!safeTokenCompare(token, cachedToken)) {
    const err = unauthorized()
    reply.code(err.statusCode).send(errorResponse(err))
    return
  }
}
