/**
 * Member write operations (merge, delete, update aliases).
 *
 * All functions accept a DatabaseAdapter, keeping them platform-agnostic.
 * The caller is responsible for opening/closing the DB connection.
 */

import type { DatabaseAdapter } from '../interfaces/database-adapter'

// ==================== Helpers ====================

function parseAliases(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

// ==================== Public API ====================

export function updateMemberAliases(db: DatabaseAdapter, memberId: number, aliases: string[]): boolean {
  try {
    db.prepare('UPDATE member SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), memberId)
    return true
  } catch {
    return false
  }
}

interface MemberMergeRow {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string | null
  avatar: string | null
  messageCount: number
}

/**
 * Merge two members — messages and name history are reassigned to the one
 * with more messages (or the lower id on tie). The secondary member is deleted.
 */
export function mergeMembers(db: DatabaseAdapter, memberId1: number, memberId2: number): boolean {
  if (memberId1 === memberId2) return false

  try {
    const rows = db
      .prepare(
        `
        SELECT
          m.id,
          m.platform_id as platformId,
          m.account_name as accountName,
          m.group_nickname as groupNickname,
          m.aliases,
          m.avatar,
          COUNT(msg.id) as messageCount
        FROM member m
        LEFT JOIN message msg ON m.id = msg.sender_id
        WHERE m.id IN (?, ?)
        GROUP BY m.id
      `
      )
      .all(memberId1, memberId2) as unknown as MemberMergeRow[]

    if (rows.length !== 2) return false

    const [memberA, memberB] = rows
    let primary = memberA
    let secondary = memberB

    if (
      memberB.messageCount > memberA.messageCount ||
      (memberB.messageCount === memberA.messageCount && memberB.id < memberA.id)
    ) {
      primary = memberB
      secondary = memberA
    }

    const mergedAliases = Array.from(new Set([...parseAliases(primary.aliases), ...parseAliases(secondary.aliases)]))
    const mergedAccountName = primary.accountName || secondary.accountName
    const mergedGroupNickname = primary.groupNickname || secondary.groupNickname
    const mergedAvatar = primary.avatar || secondary.avatar

    db.transaction(() => {
      db.prepare('UPDATE message SET sender_id = ? WHERE sender_id = ?').run(primary.id, secondary.id)
      db.prepare('UPDATE member_name_history SET member_id = ? WHERE member_id = ?').run(primary.id, secondary.id)
      db.prepare('UPDATE meta SET owner_id = ? WHERE owner_id = ?').run(primary.platformId, secondary.platformId)
      db.prepare(`UPDATE member SET account_name = ?, group_nickname = ?, avatar = ?, aliases = ? WHERE id = ?`).run(
        mergedAccountName,
        mergedGroupNickname,
        mergedAvatar,
        JSON.stringify(mergedAliases),
        primary.id
      )
      db.prepare('DELETE FROM member WHERE id = ?').run(secondary.id)
    })

    return true
  } catch {
    return false
  }
}

/**
 * Delete members and all their messages / name history in one transaction.
 */
export function deleteMembers(db: DatabaseAdapter, memberIds: readonly number[]): boolean {
  const uniqueMemberIds = Array.from(new Set(memberIds))
  if (uniqueMemberIds.length === 0) return false

  const placeholders = uniqueMemberIds.map(() => '?').join(', ')
  db.transaction(() => {
    db.prepare(`DELETE FROM message WHERE sender_id IN (${placeholders})`).run(...uniqueMemberIds)
    db.prepare(`DELETE FROM member_name_history WHERE member_id IN (${placeholders})`).run(...uniqueMemberIds)
    db.prepare(`DELETE FROM member WHERE id IN (${placeholders})`).run(...uniqueMemberIds)
  })
  return true
}

/**
 * Delete a member and all their messages / name history.
 */
export function deleteMember(db: DatabaseAdapter, memberId: number): boolean {
  try {
    return deleteMembers(db, [memberId])
  } catch {
    return false
  }
}

/**
 * Ensure the `aliases` column exists on the `member` table (DDL migration).
 */
export function ensureAliasesColumn(db: DatabaseAdapter): boolean {
  const columns = db.prepare('PRAGMA table_info(member)').all() as unknown as Array<{ name: string }>
  const has = columns.some((col) => col.name === 'aliases')
  if (!has) {
    db.exec("ALTER TABLE member ADD COLUMN aliases TEXT DEFAULT '[]'")
    return true
  }
  return false
}

/**
 * Ensure the `avatar` column exists on the `member` table (DDL migration).
 */
export function ensureAvatarColumn(db: DatabaseAdapter): boolean {
  const columns = db.prepare('PRAGMA table_info(member)').all() as unknown as Array<{ name: string }>
  const has = columns.some((col) => col.name === 'avatar')
  if (!has) {
    db.exec('ALTER TABLE member ADD COLUMN avatar TEXT')
    return true
  }
  return false
}
