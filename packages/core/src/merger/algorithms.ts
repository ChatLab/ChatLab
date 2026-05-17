/**
 * Merger pure algorithms — platform ID collision detection,
 * normalization, conflict detection, and dedup-sort merge.
 *
 * All functions are pure (no I/O, no Node.js deps).
 */

import { generateMessageKey } from '../import/dedup'

// ==================== Types ====================

export interface MergerMember {
  platformId: string
  accountName?: string
  groupNickname?: string
  avatar?: string
}

export interface MergerMessage {
  senderPlatformId: string
  senderAccountName?: string
  senderGroupNickname?: string
  timestamp: number
  type: number
  content?: string | null
}

export interface MergeConflict {
  id: string
  timestamp: number
  sender: string
  contentLength1: number
  contentLength2: number
  content1: string
  content2: string
}

export interface ConflictCheckResult {
  conflicts: MergeConflict[]
  totalMessages: number
}

export interface MergedMember {
  platformId: string
  accountName?: string
  groupNickname?: string
  avatar?: string
}

export interface MergedMessage {
  sender: string
  accountName?: string
  groupNickname?: string
  timestamp: number
  type: number
  content?: string | null
}

// ==================== Platform ID collision ====================

export function getCollidingPlatformIds(
  sources: Array<{ platform: string; members: Array<{ platformId: string }> }>
): Set<string> {
  const map = new Map<string, Set<string>>()
  for (const source of sources) {
    for (const member of source.members) {
      if (!map.has(member.platformId)) map.set(member.platformId, new Set())
      map.get(member.platformId)!.add(source.platform || 'unknown')
    }
  }
  const result = new Set<string>()
  for (const [id, platforms] of map) {
    if (platforms.size > 1) result.add(id)
  }
  return result
}

export function getCollidingPlatformIdsFromMessages(
  allMessages: Array<{ msg: MergerMessage; platform: string }>
): Set<string> {
  const map = new Map<string, Set<string>>()
  for (const item of allMessages) {
    const pid = item.msg.senderPlatformId
    if (!map.has(pid)) map.set(pid, new Set())
    map.get(pid)!.add(item.platform || 'unknown')
  }
  const result = new Set<string>()
  for (const [id, platforms] of map) {
    if (platforms.size > 1) result.add(id)
  }
  return result
}

export function normalizePlatformId(platformId: string, platform: string, collidingIds: Set<string>): string {
  if (!collidingIds.has(platformId)) return platformId
  const np = encodeURIComponent(platform || 'unknown')
  const ni = encodeURIComponent(platformId)
  return `__chatlab_platform__${np}__${ni}`
}

// ==================== Helpers ====================

function getMessageKey(msg: MergerMessage, senderOverride?: string): string {
  return generateMessageKey(msg.timestamp, senderOverride || msg.senderPlatformId, msg.content ?? null)
}

function getDisplayName(msg: MergerMessage): string {
  return msg.senderGroupNickname || msg.senderAccountName || msg.senderPlatformId
}

function isImageOnlyMessage(content: string | undefined | null): boolean {
  if (!content) return false
  return /^\[图片:\s*.+\]$/.test(content.trim())
}

// ==================== Conflict detection ====================

export function detectConflictsInMessages(
  allMessages: Array<{ msg: MergerMessage; source: string; platform: string }>
): ConflictCheckResult {
  const collidingIds = getCollidingPlatformIdsFromMessages(allMessages)
  const conflicts: MergeConflict[] = []

  const timeGroups = new Map<number, Array<{ msg: MergerMessage; source: string; platform: string }>>()
  for (const item of allMessages) {
    const ts = item.msg.timestamp
    if (!timeGroups.has(ts)) timeGroups.set(ts, [])
    timeGroups.get(ts)!.push(item)
  }

  for (const [ts, items] of timeGroups) {
    if (items.length < 2) continue

    const senderGroups = new Map<string, typeof items>()
    for (const item of items) {
      const sender = normalizePlatformId(item.msg.senderPlatformId, item.platform || 'unknown', collidingIds)
      if (!senderGroups.has(sender)) senderGroups.set(sender, [])
      senderGroups.get(sender)!.push(item)
    }

    for (const [sender, senderItems] of senderGroups) {
      if (senderItems.length < 2) continue
      const sources = new Set(senderItems.map((it) => it.source))
      if (sources.size < 2) continue

      const contentGroups = new Map<string, typeof senderItems>()
      for (const item of senderItems) {
        const c = item.msg.content || ''
        if (!contentGroups.has(c)) contentGroups.set(c, [])
        contentGroups.get(c)!.push(item)
      }

      if (contentGroups.size > 1) {
        const entries = Array.from(contentGroups.entries())
        for (let i = 0; i < entries.length - 1; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const [c1, items1] = entries[i]
            const [c2, items2] = entries[j]
            const item1 = items1[0]
            const item2 = items2.find((it) => it.source !== item1.source)
            if (!item2) continue
            if (isImageOnlyMessage(c1) && isImageOnlyMessage(c2)) continue

            conflicts.push({
              id: `conflict_${ts}_${sender}_${conflicts.length}`,
              timestamp: ts,
              sender: getDisplayName(item1.msg) || sender,
              contentLength1: c1.length,
              contentLength2: c2.length,
              content1: c1,
              content2: c2,
            })
          }
        }
      }
    }
  }

  const uniqueKeys = new Set<string>()
  for (const item of allMessages) {
    const nid = normalizePlatformId(item.msg.senderPlatformId, item.platform || 'unknown', collidingIds)
    uniqueKeys.add(getMessageKey(item.msg, nid))
  }

  return { conflicts, totalMessages: uniqueKeys.size }
}

// ==================== Member merge ====================

export function mergeMembers(
  sources: Array<{ platform: string; members: MergerMember[] }>,
  collidingIds: Set<string>
): Map<string, MergedMember> {
  const map = new Map<string, MergedMember>()
  for (const { platform, members } of sources) {
    const p = platform || 'unknown'
    for (const m of members) {
      const nid = normalizePlatformId(m.platformId, p, collidingIds)
      const existing = map.get(nid)
      if (existing) {
        if (m.accountName) existing.accountName = m.accountName
        if (m.groupNickname) existing.groupNickname = m.groupNickname
        if (m.avatar) existing.avatar = m.avatar
      } else {
        map.set(nid, {
          platformId: nid,
          accountName: m.accountName,
          groupNickname: m.groupNickname,
          avatar: m.avatar,
        })
      }
    }
  }
  return map
}

// ==================== Message dedup + sort ====================

export function deduplicateAndSortMessages(
  sources: Array<{ platform: string; messages: MergerMessage[] }>,
  collidingIds: Set<string>
): MergedMessage[] {
  const seen = new Set<string>()
  const merged: MergedMessage[] = []

  for (const { platform, messages } of sources) {
    const p = platform || 'unknown'
    for (const msg of messages) {
      const nid = normalizePlatformId(msg.senderPlatformId, p, collidingIds)
      const key = getMessageKey(msg, nid)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        sender: nid,
        accountName: msg.senderAccountName,
        groupNickname: msg.senderGroupNickname,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
      })
    }
  }

  merged.sort((a, b) => a.timestamp - b.timestamp)
  return merged
}
