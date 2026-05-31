/**
 * ChatLab HTTP API — Bearer Token authentication hook
 *
 * 从 electron/main/api/auth.ts 迁移，使用 @openchatlab/config 读取 token。
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual } from 'crypto'
import { unauthorized, errorResponse } from './errors'

let cachedToken: string | null = null
let webModeEnabled = false
let requireAuthEnabled = false

/**
 * 设置 auth hook 使用的 token（由 server 启动时注入）
 */
export function setAuthToken(token: string): void {
  cachedToken = token
}

/**
 * Enable web mode: static resources and SPA paths bypass auth.
 * Only `/api/` routes remain protected.
 */
export function setWebMode(enabled: boolean): void {
  webModeEnabled = enabled
}

/**
 * When enabled, /_web/* routes also require Bearer token (same as /api/*).
 * Used for server/headless deployments where same-origin assumption doesn't hold.
 */
export function setRequireAuth(enabled: boolean): void {
  requireAuthEnabled = enabled
}

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!cachedToken) return

  // /_web/ internal API: skip auth unless require_auth is enabled
  if (request.url.startsWith('/_web/') && !requireAuthEnabled) return

  // Web mode: only /api/ routes require auth; static files and SPA are public
  if (webModeEnabled && !request.url.startsWith('/api/')) return

  return requireBearerToken(request, reply)
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
