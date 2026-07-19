/**
 * Shared import writer helpers.
 *
 * Functions here operate on DatabaseAdapter and can be used by any
 * environment that wraps its DB connection accordingly.
 */

import type { DatabaseAdapter } from '../interfaces'
import type { ParsedMember, ParsedMessage } from '@openchatlab/shared-types'

export interface ImportMeta {
  name: string
  platform: string
  type: string
  groupId?: string | null
  groupAvatar?: string | null
  ownerId?: string | null
}

export interface WriteParseResultStats {
  messageCount: number
  memberCount: number
  skippedCount: number
}

/**
 * Build a Map from member platform_id → internal row id.
 * Used after bulk member insert to resolve sender_id for messages.
 */
export function buildMemberIdMap(db: DatabaseAdapter): Map<string, number> {
  const rows = db.prepare('SELECT id, platform_id FROM member').all() as Array<{ id: number; platform_id: string }>
  const map = new Map<string, number>()
  for (const row of rows) {
    map.set(row.platform_id, row.id)
  }
  return map
}

/**
 * Write a complete parsed chat into an initialized chat database.
 *
 * The transaction covers metadata, members, messages, and name history so a
 * failed import never leaves a partially populated session database.
 */
export function writeParseResultToDb(
  db: DatabaseAdapter,
  meta: ImportMeta,
  members: readonly ParsedMember[],
  messages: readonly ParsedMessage[]
): WriteParseResultStats {
  let messageCount = 0
  let skippedCount = 0

  db.transaction(() => {
    db.prepare(
      `INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      meta.name,
      meta.platform,
      meta.type,
      Math.floor(Date.now() / 1000),
      meta.groupId || null,
      meta.groupAvatar || null,
      meta.ownerId || null
    )

    const insertMember = db.prepare(
      `INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, aliases, avatar, roles) VALUES (?, ?, ?, ?, ?, ?)`
    )
    const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')
    const memberIdMap = new Map<string, number>()

    for (const member of members) {
      insertMember.run(
        member.platformId,
        member.accountName || null,
        member.groupNickname || null,
        member.aliases ? JSON.stringify(member.aliases) : '[]',
        member.avatar || null,
        member.roles ? JSON.stringify(member.roles) : '[]'
      )
      const row = getMemberId.get(member.platformId) as { id: number }
      memberIdMap.set(member.platformId, row.id)
    }

    const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp)
    const accountNameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()
    const groupNicknameTracker = new Map<string, { currentName: string; lastSeenTs: number }>()
    const insertMessage = db.prepare(
      `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertNameHistory = db.prepare(
      'INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (?, ?, ?, ?, ?)'
    )
    const updateMemberAccountName = db.prepare('UPDATE member SET account_name = ? WHERE platform_id = ?')
    const updateMemberGroupNickname = db.prepare('UPDATE member SET group_nickname = ? WHERE platform_id = ?')
    const updateNameHistoryEndTs = db.prepare(
      'UPDATE member_name_history SET end_ts = ? WHERE member_id = ? AND name_type = ? AND end_ts IS NULL'
    )

    for (const message of sortedMessages) {
      const senderId = memberIdMap.get(message.senderPlatformId)
      if (senderId === undefined) {
        skippedCount += 1
        continue
      }

      insertMessage.run(
        senderId,
        message.senderAccountName || null,
        message.senderGroupNickname || null,
        message.timestamp,
        message.type,
        message.content,
        message.replyToMessageId || null,
        message.platformMessageId || null
      )
      messageCount += 1

      trackMemberName({
        name: message.senderAccountName,
        nameType: 'account_name',
        platformId: message.senderPlatformId,
        senderId,
        timestamp: message.timestamp,
        tracker: accountNameTracker,
        insertNameHistory,
        updateNameHistoryEndTs,
      })
      trackMemberName({
        name: message.senderGroupNickname,
        nameType: 'group_nickname',
        platformId: message.senderPlatformId,
        senderId,
        timestamp: message.timestamp,
        tracker: groupNicknameTracker,
        insertNameHistory,
        updateNameHistoryEndTs,
      })
    }

    for (const [platformId, tracker] of accountNameTracker) {
      updateMemberAccountName.run(tracker.currentName, platformId)
    }
    for (const [platformId, tracker] of groupNicknameTracker) {
      updateMemberGroupNickname.run(tracker.currentName, platformId)
    }
  })

  return { messageCount, memberCount: members.length, skippedCount }
}

interface TrackMemberNameOptions {
  name?: string
  nameType: 'account_name' | 'group_nickname'
  platformId: string
  senderId: number
  timestamp: number
  tracker: Map<string, { currentName: string; lastSeenTs: number }>
  insertNameHistory: ReturnType<DatabaseAdapter['prepare']>
  updateNameHistoryEndTs: ReturnType<DatabaseAdapter['prepare']>
}

function trackMemberName(options: TrackMemberNameOptions): void {
  if (!options.name) return
  const current = options.tracker.get(options.platformId)
  if (!current) {
    options.tracker.set(options.platformId, { currentName: options.name, lastSeenTs: options.timestamp })
    options.insertNameHistory.run(options.senderId, options.nameType, options.name, options.timestamp, null)
    return
  }

  if (current.currentName !== options.name) {
    options.updateNameHistoryEndTs.run(options.timestamp, options.senderId, options.nameType)
    options.insertNameHistory.run(options.senderId, options.nameType, options.name, options.timestamp, null)
    current.currentName = options.name
  }
  current.lastSeenTs = options.timestamp
}
