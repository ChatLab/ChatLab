/**
 * ChatLab HTTP API — Bearer Token authentication hook
 *
 * Shared auth middleware factory for CLI and Electron APIs.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual, createHmac, randomBytes } from 'crypto'
import { unauthorized, errorResponse } from './errors'

export interface BearerAuthOptions {
  getToken: () => string | null | undefined
  shouldAuthenticate?: (request: FastifyRequest) => boolean
  allowMissingToken?: boolean
  missingTokenMessage?: string
  invalidTokenMessage?: string
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
