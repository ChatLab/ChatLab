/**
 * 基础查询模块
 * 查询逻辑委托给 @openchatlab/core，本模块负责数据库连接管理和成员 DDL 迁移
 */

import * as fs from 'fs'
import { closeDatabase, getDbPath, getCacheDir, openRawDatabase, openDatabaseAdapter, type TimeFilter } from '../core'
import { getCache, CACHE_KEY_OVERVIEW, type OverviewCache } from '@openchatlab/node-runtime'
import {
  getAvailableYears as coreGetAvailableYears,
  getMemberActivity as coreGetMemberActivity,
  getHourlyActivity as coreGetHourlyActivity,
  getDailyActivity as coreGetDailyActivity,
  getWeekdayActivity as coreGetWeekdayActivity,
  getMonthlyActivity as coreGetMonthlyActivity,
  getYearlyActivity as coreGetYearlyActivity,
  getMessageTypeStats as coreGetMessageTypeStats,
  getMessageLengthDistribution as coreGetMessageLengthDistribution,
  getTimeRange as coreGetTimeRange,
  getMemberNameHistory as coreGetMemberNameHistory,
  getMembersWithAliases as coreGetMembersWithAliases,
  getMembersPaginated as coreGetMembersPaginated,
  updateMemberAliases as coreUpdateMemberAliases,
  mergeMembers as coreMergeMembers,
  deleteMember as coreDeleteMember,
  ensureAliasesColumn as coreEnsureAliasesColumn,
  ensureAvatarColumn as coreEnsureAvatarColumn,
} from '@openchatlab/core'
import type { MembersPaginationParams, MembersPaginatedResult, MemberWithAliases } from '@openchatlab/core'
import { BetterSqliteAdapter } from '@openchatlab/node-runtime'

// ==================== 基础查询（委托给 core） ====================

export function getAvailableYears(sessionId: string): number[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetAvailableYears(db)
}

export function getMemberActivity(sessionId: string, filter?: TimeFilter): any[] {
  ensureAvatarColumn(sessionId)
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetMemberActivity(db, filter)
}

export function getHourlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetHourlyActivity(db, filter)
}

export function getDailyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetDailyActivity(db, filter)
}

export function getWeekdayActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetWeekdayActivity(db, filter)
}

export function getMonthlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetMonthlyActivity(db, filter)
}

export function getYearlyActivity(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetYearlyActivity(db, filter)
}

export function getMessageTypeDistribution(sessionId: string, filter?: TimeFilter): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetMessageTypeStats(db, filter)
}

export function getMessageLengthDistribution(
  sessionId: string,
  filter?: TimeFilter
): {
  detail: Array<{ len: number; count: number }>
  grouped: Array<{ range: string; count: number }>
} {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return { detail: [], grouped: [] }
  return coreGetMessageLengthDistribution(db, filter)
}

export function getTimeRange(sessionId: string): { start: number; end: number } | null {
  const overview = getCache<OverviewCache>(sessionId, CACHE_KEY_OVERVIEW, getCacheDir())
  if (overview?.firstMessageTs != null && overview?.lastMessageTs != null) {
    return { start: overview.firstMessageTs, end: overview.lastMessageTs }
  }
  const db = openDatabaseAdapter(sessionId)
  if (!db) return null
  return coreGetTimeRange(db)
}

/**
 * 获取成员的历史昵称记录 (delegates to core)
 */
export function getMemberNameHistory(sessionId: string, memberId: number): any[] {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetMemberNameHistory(db, memberId)
}

// ==================== 成员管理 ====================

const aliasesCheckedSessions = new Set<string>()
const avatarCheckedSessions = new Set<string>()

function ensureAliasesColumn(sessionId: string): void {
  if (aliasesCheckedSessions.has(sessionId)) return
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return
  closeDatabase(sessionId)
  const db = openRawDatabase(dbPath)
  try {
    const adapter = new BetterSqliteAdapter(db)
    if (coreEnsureAliasesColumn(adapter)) {
      console.log(`[Worker] Added aliases column to member table in session ${sessionId}`)
    }
    aliasesCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

export function ensureAvatarColumn(sessionId: string): void {
  if (avatarCheckedSessions.has(sessionId)) return
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return
  closeDatabase(sessionId)
  const db = openRawDatabase(dbPath)
  try {
    const adapter = new BetterSqliteAdapter(db)
    if (coreEnsureAvatarColumn(adapter)) {
      console.log(`[Worker] Added avatar column to member table in session ${sessionId}`)
    }
    avatarCheckedSessions.add(sessionId)
  } finally {
    db.close()
  }
}

/**
 * 获取所有成员列表（含消息数、别名和头像）
 * Delegates to core getMembersWithAliases after ensuring schema columns exist.
 */
export function getMembers(sessionId: string): MemberWithAliases[] {
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)

  const db = openDatabaseAdapter(sessionId)
  if (!db) return []
  return coreGetMembersWithAliases(db)
}

export type { MembersPaginationParams, MembersPaginatedResult }

/**
 * 获取成员列表（分页版本，支持搜索和排序）
 * Delegates to core getMembersPaginated after ensuring schema columns exist.
 */
export function getMembersPaginated(sessionId: string, params: MembersPaginationParams): MembersPaginatedResult {
  ensureAliasesColumn(sessionId)
  ensureAvatarColumn(sessionId)

  const db = openDatabaseAdapter(sessionId)
  if (!db) {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20
    return { members: [], total: 0, page, pageSize, totalPages: 0 }
  }
  return coreGetMembersPaginated(db, params)
}

export function updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return false
  try {
    const db = openRawDatabase(dbPath)
    const adapter = new BetterSqliteAdapter(db)
    const result = coreUpdateMemberAliases(adapter, memberId, aliases)
    db.close()
    return result
  } catch (error) {
    console.error('[Worker] Failed to update member aliases:', error)
    return false
  }
}

export function mergeMembers(sessionId: string, memberId1: number, memberId2: number): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return false
  try {
    const db = openRawDatabase(dbPath)
    const adapter = new BetterSqliteAdapter(db)
    const result = coreMergeMembers(adapter, memberId1, memberId2)
    db.close()
    return result
  } catch (error) {
    console.error('[Worker] Failed to merge members:', error)
    return false
  }
}

export function deleteMember(sessionId: string, memberId: number): boolean {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) return false
  try {
    const db = openRawDatabase(dbPath)
    const adapter = new BetterSqliteAdapter(db)
    const result = coreDeleteMember(adapter, memberId)
    db.close()
    return result
  } catch (error) {
    console.error('[Worker] Failed to delete member:', error)
    return false
  }
}
