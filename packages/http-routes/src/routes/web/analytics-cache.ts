/**
 * Shared analytics result caching for HTTP route handlers.
 *
 * Wraps expensive analytics / NLP computations with the platform-agnostic
 * analytics cache (cacheDir/query/{sessionId}.cache.json). Used by both CLI Web
 * (`chatlab start`) and the Electron internal server so the two share one cache
 * implementation. Validity is keyed to the product version plus the session DB
 * file fingerprint, so any release that changes query logic, and any import /
 * incremental import / member edit, transparently invalidates entries.
 */

import * as path from 'path'
import { getDbFileVersion, getOrComputeAnalysisCache } from '@openchatlab/node-runtime'
import type { PathProvider } from '@openchatlab/core'
import type { SessionRuntimeAdapter } from '@openchatlab/node-runtime'

export interface AnalyticsCacheContext {
  pathProvider: Pick<PathProvider, 'getCacheDir'>
  sessionAdapter: Pick<SessionRuntimeAdapter, 'getDbPath'>
  getVersion: () => string
}

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
 *
 * Pass `options.dailyInvalidate: true` for endpoints whose results depend on
 * the current date (e.g. daysSinceLastMessage, currentStreak). This appends
 * today's date to the version string so the cache is refreshed each day even
 * when the DB file has not changed.
 *
 * Pass `options.extraVersion` to append an arbitrary fingerprint to the version
 * (e.g. an external file's mtime/size) so the cache is invalidated whenever
 * that resource changes independently of the DB or app version.
 */
export function withAnalyticsCache<T>(
  ctx: AnalyticsCacheContext,
  sessionId: string,
  namespace: string,
  params: Record<string, unknown>,
  compute: () => T,
  options?: { dailyInvalidate?: boolean; extraVersion?: string }
): T {
  const queryCacheDir = path.join(ctx.pathProvider.getCacheDir(), 'query')
  const dateStr = options?.dailyInvalidate ? `|date:${new Date().toISOString().split('T')[0]}` : ''
  const extraStr = options?.extraVersion ? `|${options.extraVersion}` : ''
  const version = `${ctx.getVersion()}|${getDbFileVersion(ctx.sessionAdapter.getDbPath(sessionId))}${dateStr}${extraStr}`
  const key = buildAnalyticsCacheKey(namespace, params)
  return getOrComputeAnalysisCache(sessionId, key, queryCacheDir, version, compute)
}
