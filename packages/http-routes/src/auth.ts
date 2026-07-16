/**
 * ChatLab HTTP API — Bearer Token authentication hook
 *
 * Shared auth middleware for CLI Server and Electron APIs.
 * URL classification: /api/* always requires token, /_web/* conditionally,
 * static files and SPA fallback are public.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual, createHmac, randomBytes } from 'crypto'
import { unauthorized, errorResponse } from './errors'

let cachedToken: string | null = null
let requireAuthEnabled = false

export interface BearerAuthOptions {
  getToken: () => string | null | undefined
  shouldAuthenticate?: (request: FastifyRequest) => boolean
  allowMissingToken?: boolean
  missingTokenMessage?: string
  invalidTokenMessage?: string
}

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

export function createBearerAuthHook(options: BearerAuthOptions) {
  // Compare via HMAC digests (fixed 32-byte length) to avoid leaking token length.
  const hmacKey = randomBytes(32)
  const safeTokenCompare = (provided: string, expected: string): boolean => {
    const providedHash = createHmac('sha256', hmacKey).update(provided).digest()
    const expectedHash = createHmac('sha256', hmacKey).update(expected).digest()
    return timingSafeEqual(providedHash, expectedHash)
  }

  return async function bearerAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (options.shouldAuthenticate && !options.shouldAuthenticate(request)) return

    const expectedToken = options.getToken()
    if (!expectedToken && options.allowMissingToken !== false) return

    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const err = unauthorized(options.missingTokenMessage)
      reply.code(err.statusCode).send(errorResponse(err))
      return
    }

    const providedToken = authHeader.slice(7)
    if (!expectedToken || !safeTokenCompare(providedToken, expectedToken)) {
      const err = unauthorized(options.invalidTokenMessage)
      reply.code(err.statusCode).send(errorResponse(err))
    }
  }
}

export const authHook = createBearerAuthHook({
  getToken: () => cachedToken,
  shouldAuthenticate: (request) =>
    request.url.startsWith('/api/') || (requireAuthEnabled && request.url.startsWith('/_web/')),
})
