/**
 * Session-level JSON cache module (platform-agnostic).
 *
 * Extracted from electron/main/database/sessionCache.ts.
 * Each session has a {sessionId}.cache.json file partitioned by key.
 * Decoupled from DB schema — reads auto-rebuild on failure, no versioning needed.
 *
 * File path: {cacheDir}/{sessionId}.cache.json
 */

import * as fs from 'fs'
import * as path from 'path'
import type { DatabaseAdapter } from '@openchatlab/core'

// ==================== Generic cache infrastructure ====================

interface CacheEntry<T = unknown> {
  data: T
  ts: number
}

type CacheFile = Record<string, CacheEntry>

export function getCachePath(sessionId: string, cacheDir: string): string {
  return path.join(cacheDir, `${sessionId}.cache.json`)
}

function readCacheFile(cachePath: string): CacheFile | null {
  try {
    if (!fs.existsSync(cachePath)) return null
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CacheFile
  } catch {
    return null
  }
}

function writeCacheFile(cachePath: string, content: CacheFile): void {
  try {
    const dir = path.dirname(cachePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(cachePath, JSON.stringify(content), 'utf-8')
  } catch {
    // Write failure is non-fatal
  }
}

export function getCache<T>(sessionId: string, key: string, cacheDir: string): T | null {
  const cachePath = getCachePath(sessionId, cacheDir)
  const file = readCacheFile(cachePath)
  if (!file || !file[key]) return null
  return file[key].data as T
}

export function setCache<T>(sessionId: string, key: string, data: T, cacheDir: string): void {
  const cachePath = getCachePath(sessionId, cacheDir)
  const file = readCacheFile(cachePath) ?? {}
  file[key] = { data, ts: Math.floor(Date.now() / 1000) }
  writeCacheFile(cachePath, file)
}

export function invalidateCache(sessionId: string, cacheDir: string, key?: string): void {
  const cachePath = getCachePath(sessionId, cacheDir)
  try {
    if (!key) {
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
    } else {
      const file = readCacheFile(cachePath)
      if (file && file[key]) {
        delete file[key]
        writeCacheFile(cachePath, file)
      }
    }
  } catch {
    // Ignore
  }
}

export function deleteSessionCache(sessionId: string, cacheDir: string): void {
  const cachePath = getCachePath(sessionId, cacheDir)
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  } catch {
    // Ignore
  }
}

// ==================== Overview cache (aggregate stats) ====================

export const CACHE_KEY_OVERVIEW = 'overview'

export interface OverviewCache {
  totalMessages: number
  totalMembers: number
  firstMessageTs: number | null
  lastMessageTs: number | null
  /**
   * MAX(message.id) at the time the cache was written.
   * Used as a cheap O(1) freshness fingerprint: if current MAX(id) differs
   * the cache is stale and must be recomputed.  Absent in legacy cache files
   * written before this field was added; absence is treated as stale.
   */
  maxMessageId?: number
}

/**
 * Return the current MAX(message.id) for freshness checking.
 * This is O(1) via the AUTOINCREMENT rowid B-tree.
 * Returns 0 for an empty table.
 */
function getMaxMessageId(db: DatabaseAdapter): number {
  const row = db.prepare('SELECT MAX(id) AS m FROM message').get() as { m: number | null }
  return row.m ?? 0
}

export function computeAndSetOverviewCache(db: DatabaseAdapter, sessionId: string, cacheDir: string): OverviewCache {
  const msgStats = db.prepare('SELECT MIN(ts) as first_ts, MAX(ts) as last_ts FROM message').get() as {
    first_ts: number | null
    last_ts: number | null
  }

  const totalMessages = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE COALESCE(m.account_name, '') != '系统消息'`
      )
      .get() as { count: number }
  ).count

  const totalMembers = (
    db.prepare(`SELECT COUNT(*) as count FROM member WHERE COALESCE(account_name, '') != '系统消息'`).get() as {
      count: number
    }
  ).count

  const data: OverviewCache = {
    totalMessages,
    totalMembers,
    firstMessageTs: msgStats.first_ts,
    lastMessageTs: msgStats.last_ts,
    maxMessageId: getMaxMessageId(db),
  }

  setCache(sessionId, CACHE_KEY_OVERVIEW, data, cacheDir)
  computeAndSetMembersCache(db, sessionId, cacheDir)

  return data
}

/**
 * Cache-first overview read with fingerprint validation.
 *
 * Checks cached `maxMessageId` against the live `MAX(message.id)`.  If they
 * match the cache is fresh and returned as-is (one extra O(1) query).
 * On any mismatch — new inserts, legacy cache lacking the field, or a cold
 * miss — the cache is recomputed and written before returning.
 *
 * Use this instead of bare `getCache` whenever you need a guaranteed-fresh
 * overview (e.g. AI system prompt data-snapshot construction).
 */
export function getValidatedOverviewCache(db: DatabaseAdapter, sessionId: string, cacheDir: string): OverviewCache {
  const cached = getCache<OverviewCache>(sessionId, CACHE_KEY_OVERVIEW, cacheDir)
  if (cached && cached.maxMessageId !== undefined && cached.maxMessageId === getMaxMessageId(db)) {
    return cached
  }
  return computeAndSetOverviewCache(db, sessionId, cacheDir)
}

// ==================== Members cache (per-member stats) ====================

export const CACHE_KEY_MEMBERS = 'members'

export interface MemberStat {
  name: string
  count: number
}

export interface MembersCache {
  members: Record<number, MemberStat>
}

export function computeAndSetMembersCache(db: DatabaseAdapter, sessionId: string, cacheDir: string): MembersCache {
  const rows = db
    .prepare(
      `SELECT msg.sender_id, COUNT(*) as count,
              COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       GROUP BY msg.sender_id`
    )
    .all() as Array<{ sender_id: number; count: number; name: string }>

  const members: Record<number, MemberStat> = {}
  for (const row of rows) {
    members[row.sender_id] = { name: row.name, count: row.count }
  }

  const data: MembersCache = { members }
  setCache(sessionId, CACHE_KEY_MEMBERS, data, cacheDir)
  return data
}
