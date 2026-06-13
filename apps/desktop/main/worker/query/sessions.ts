/**
 * 会话管理查询模块
 * 负责会话列表与单会话基础信息查询
 *
 * Core session info logic delegated to @openchatlab/core (buildSessionInfo, getSessionMeta, etc.).
 * This file retains Electron-specific concerns: filesystem scanning, caching, private chat avatar,
 * dbPath, aiConversationCount, and the getChatOverview cache-first pattern.
 */

import Database from 'better-sqlite3'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime'
import * as fs from 'fs'
import * as path from 'path'
import { openDatabase, getDbDir, getDbPath, getCacheDir } from '../core'
import {
  getCache,
  getValidatedOverviewCache,
  computeAndSetMembersCache,
  CACHE_KEY_MEMBERS,
  type MembersCache,
} from '@openchatlab/node-runtime'
import {
  getSessionMeta,
  getSessionOverview,
  buildSessionInfo,
  getSummaryCount,
  getLastPlatformMessageId,
  getPrivateChatMemberAvatar,
  type SessionOverview,
} from '@openchatlab/core'
import type { DatabaseAdapter } from '@openchatlab/core'

/**
 * Wrap a better-sqlite3 Database as a DatabaseAdapter for core query functions.
 */
function asCoreDb(db: Database.Database): DatabaseAdapter {
  return db as unknown as DatabaseAdapter
}

/**
 * 判断是否为聊天会话数据库（local fast check, avoids core import overhead for non-session DBs）
 */
function isChatSessionDb(db: Database.Database): boolean {
  const requiredTableCount = db
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('meta', 'member', 'message')")
    .get() as { cnt: number }
  return requiredTableCount.cnt === 3
}

/**
 * Resolve overview with fingerprint-validated cache, falling back to live SQL.
 *
 * Uses getValidatedOverviewCache which checks MAX(message.id) so the cache is
 * automatically recomputed whenever new messages are inserted (e.g. after
 * incremental import), without relying on the import hook always succeeding.
 */
function resolveOverview(db: Database.Database, sessionId: string, cacheDir: string | null): SessionOverview {
  if (cacheDir) {
    try {
      return getValidatedOverviewCache(new BetterSqliteAdapter(db), sessionId, cacheDir)
    } catch {
      // cache compute failure — fall through to live query
    }
  }
  return getSessionOverview(asCoreDb(db))
}

/**
 * 获取所有会话列表
 */
export function getAllSessions(): any[] {
  const dbDir = getDbDir()
  if (!fs.existsSync(dbDir)) {
    return []
  }

  const sessions: any[] = []
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const dbPath = path.join(dbDir, file)

    try {
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')

      if (!isChatSessionDb(db)) {
        db.close()
        continue
      }

      const coreDb = asCoreDb(db)
      const meta = getSessionMeta(coreDb)

      if (meta) {
        const cacheDir = getCacheDir()
        const overview = resolveOverview(db, sessionId, cacheDir)
        const summaryCount = getSummaryCount(coreDb)
        const info = buildSessionInfo(meta, overview, summaryCount)

        let memberAvatar: string | null = null
        if (meta.type === 'private') {
          memberAvatar = getPrivateChatMemberAvatar(asCoreDb(db), meta.name, meta.ownerId)
        }

        sessions.push({
          ...info,
          id: sessionId,
          dbPath,
          memberAvatar,
          aiConversationCount: 0,
        })
      }

      db.close()
    } catch (error) {
      console.error(`[Worker] Failed to read database ${file}:`, error)
    }
  }

  return sessions.sort((a, b) => b.importedAt - a.importedAt)
}

/**
 * 获取单个会话信息
 */
export function getSession(sessionId: string): any | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  const coreDb = asCoreDb(db)
  const meta = getSessionMeta(coreDb)
  if (!meta) return null

  const overview = resolveOverview(db, sessionId, getCacheDir())
  const info = buildSessionInfo(meta, overview)

  return {
    ...info,
    id: sessionId,
    dbPath: getDbPath(sessionId),
    firstTimestamp: overview.firstMessageTs,
    lastTimestamp: overview.lastMessageTs,
    lastPlatformMessageId: getLastPlatformMessageId(coreDb),
  }
}

/**
 * 获取聊天概览（AI 工具使用）
 * Cache-first: overview cache + members cache, fallback to live SQL via core.
 */
export function getChatOverview(sessionId: string, topN: number = 10) {
  const db = openDatabase(sessionId)
  if (!db) return null

  const coreDb = asCoreDb(db)
  const meta = getSessionMeta(coreDb)
  if (!meta) return null

  const cacheDir = getCacheDir()
  const overview = resolveOverview(db, sessionId, cacheDir)
  const summaryCount = getSummaryCount(coreDb)

  let membersCache = getCache<MembersCache>(sessionId, CACHE_KEY_MEMBERS, cacheDir)
  if (!membersCache) {
    try {
      membersCache = computeAndSetMembersCache(new BetterSqliteAdapter(db), sessionId, cacheDir)
    } catch {
      // fallback: no member data
    }
  }

  let topMembers: Array<{ id: number; name: string; count: number }> = []
  if (membersCache?.members) {
    topMembers = Object.entries(membersCache.members)
      .map(([id, stat]) => ({ id: Number(id), name: stat.name, count: stat.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)
  }

  return {
    name: meta.name,
    platform: meta.platform,
    type: meta.type,
    totalMessages: overview.totalMessages,
    totalMembers: overview.totalMembers,
    firstMessageTs: overview.firstMessageTs,
    lastMessageTs: overview.lastMessageTs,
    topMembers,
    summaryCount,
  }
}
