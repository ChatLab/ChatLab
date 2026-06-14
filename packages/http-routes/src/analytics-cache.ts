/**
 * Shared analytics result caching for HTTP route handlers.
 *
 * Wraps expensive analytics / NLP computations with the platform-agnostic
 * analytics cache (cacheDir/query/{sessionId}.cache.json). Used by both CLI Web
 * (`chatlab start`) and the Electron internal server so the two share one cache
 * implementation. Validity is keyed to the session DB file fingerprint, so any
 * import / incremental import / member edit transparently invalidates entries.
 */

import * as path from 'path'
import { getDbFileVersion, getOrComputeAnalysisCache } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from './context'

/** Deterministic stringify: sorts object keys recursively and drops `undefined`. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

/**
 * Build a stable cache key from a namespace (endpoint id) and its params.
 * Key order does not matter and `undefined` params are ignored, so equivalent
 * requests map to the same key.
 */
export function buildAnalyticsCacheKey(namespace: string, params: Record<string, unknown>): string {
  return `${namespace}:${canonical(params)}`
}

/**
 * Cache-first wrapper for an analytics computation bound to a session.
 * Returns the cached result when the DB file is unchanged; otherwise computes,
 * persists (tagged with the current DB fingerprint) and returns it.
 */
export function withAnalyticsCache<T>(
  ctx: HttpRouteContext,
  sessionId: string,
  namespace: string,
  params: Record<string, unknown>,
  compute: () => T
): T {
  const queryCacheDir = path.join(ctx.pathProvider.getCacheDir(), 'query')
  const version = getDbFileVersion(ctx.sessionAdapter.getDbPath(sessionId))
  const key = buildAnalyticsCacheKey(namespace, params)
  return getOrComputeAnalysisCache(sessionId, key, queryCacheDir, version, compute)
}
