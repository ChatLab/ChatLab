/**
 * Analytics result cache (platform-agnostic).
 *
 * Caches expensive analytics / NLP computations (word frequency, catchphrase,
 * activity stats, ...) as JSON under {queryCacheDir}/{sessionId}.cache.json,
 * reusing the generic session-cache infrastructure.
 *
 * Each entry carries a `v` fingerprint derived from the session DB file state.
 * Any write to the chat DB (import, incremental import, member merge/rename,
 * owner change, summary generation) changes the file and thus the fingerprint,
 * forcing a recompute. This makes the cache self-validating even across
 * processes — e.g. when `chatlab start` is serving while a separate
 * `chatlab import` mutates the same database file.
 */

import * as fs from 'fs'
import { getCache, setCache } from './session-cache'

interface VersionedEntry<T> {
  v: string
  data: T
}

/**
 * Derive a cheap version fingerprint from the session DB file state.
 *
 * Combines mtime + size of the main DB file and its `-wal` sidecar so that
 * WAL-only writes (before a checkpoint) are detected too. Missing files
 * contribute a placeholder; a fully missing DB yields a stable placeholder
 * version, which is acceptable because the caller only computes once the DB
 * actually exists.
 */
export function getDbFileVersion(dbPath: string): string {
  const parts: string[] = []
  for (const p of [dbPath, `${dbPath}-wal`]) {
    try {
      const st = fs.statSync(p)
      parts.push(`${Math.floor(st.mtimeMs)}:${st.size}`)
    } catch {
      parts.push('-')
    }
  }
  return parts.join('|')
}

/**
 * Cache-first analytics read with version validation.
 *
 * Returns the cached value when the stored fingerprint matches `version`;
 * otherwise runs `compute()`, persists the result tagged with the current
 * version (overwriting any stale entry under the same key), and returns it.
 */
export function getOrComputeAnalysisCache<T>(
  sessionId: string,
  key: string,
  queryCacheDir: string,
  version: string,
  compute: () => T
): T {
  const cached = getCache<VersionedEntry<T>>(sessionId, key, queryCacheDir)
  if (cached && cached.v === version) {
    return cached.data
  }
  const data = compute()
  setCache<VersionedEntry<T>>(sessionId, key, { v: version, data }, queryCacheDir)
  return data
}
