/**
 * Shared data writing logic for importing parsed chat data into SQLite.
 *
 * Extracted from electron/main/database/core.ts importData().
 * Used by both Electron and Server import pipelines.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
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
 * Write parsed chat data into a database that already has the schema initialized.
 *
 * Handles:
 * - Meta record insertion (with schema_version and imported_at)
 * - Member insertion with dedup (INSERT OR IGNORE)
 * - Messages sorted by timestamp, inserted with sender_id FK
 * - member_name_history tracking (account_name & group_nickname changes over time)
 * - Final member name update to latest seen values
 *
 * @param db - Database with CHAT_DB_SCHEMA already applied
 * @param meta - Chat session metadata
 * @param members - Parsed member list
 * @param messages - Parsed message list (will be sorted by timestamp internally)
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
    const getMemberId = db.prepare(`SELECT id FROM member WHERE platform_id = ?`)

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
      `INSERT INTO member_name_history (member_id, name_type, name, start_ts, end_ts) VALUES (?, ?, ?, ?, ?)`
    )
    const updateMemberAccountName = db.prepare(`UPDATE member SET account_name = ? WHERE platform_id = ?`)
    const updateMemberGroupNickname = db.prepare(`UPDATE member SET group_nickname = ? WHERE platform_id = ?`)
    const updateNameHistoryEndTs = db.prepare(
      `UPDATE member_name_history SET end_ts = ? WHERE member_id = ? AND name_type = ? AND end_ts IS NULL`
    )

    for (const msg of sortedMessages) {
      const senderId = memberIdMap.get(msg.senderPlatformId)
      if (senderId === undefined) {
        skippedCount++
        continue
      }

      insertMessage.run(
        senderId,
        msg.senderAccountName || null,
        msg.senderGroupNickname || null,
        msg.timestamp,
        msg.type,
        msg.content,
        msg.replyToMessageId || null,
        msg.platformMessageId || null
      )
      messageCount++

      const accountName = msg.senderAccountName
      if (accountName) {
        const tracker = accountNameTracker.get(msg.senderPlatformId)
        if (!tracker) {
          accountNameTracker.set(msg.senderPlatformId, {
            currentName: accountName,
            lastSeenTs: msg.timestamp,
          })
          insertNameHistory.run(senderId, 'account_name', accountName, msg.timestamp, null)
        } else if (tracker.currentName !== accountName) {
          updateNameHistoryEndTs.run(msg.timestamp, senderId, 'account_name')
          insertNameHistory.run(senderId, 'account_name', accountName, msg.timestamp, null)
          tracker.currentName = accountName
          tracker.lastSeenTs = msg.timestamp
        } else {
          tracker.lastSeenTs = msg.timestamp
        }
      }

      const groupNickname = msg.senderGroupNickname
      if (groupNickname) {
        const tracker = groupNicknameTracker.get(msg.senderPlatformId)
        if (!tracker) {
          groupNicknameTracker.set(msg.senderPlatformId, {
            currentName: groupNickname,
            lastSeenTs: msg.timestamp,
          })
          insertNameHistory.run(senderId, 'group_nickname', groupNickname, msg.timestamp, null)
        } else if (tracker.currentName !== groupNickname) {
          updateNameHistoryEndTs.run(msg.timestamp, senderId, 'group_nickname')
          insertNameHistory.run(senderId, 'group_nickname', groupNickname, msg.timestamp, null)
          tracker.currentName = groupNickname
          tracker.lastSeenTs = msg.timestamp
        } else {
          tracker.lastSeenTs = msg.timestamp
        }
      }
    }

    for (const [platformId, tracker] of accountNameTracker.entries()) {
      updateMemberAccountName.run(tracker.currentName, platformId)
    }
    for (const [platformId, tracker] of groupNicknameTracker.entries()) {
      updateMemberGroupNickname.run(tracker.currentName, platformId)
    }
  })

  return { messageCount, memberCount: members.length, skippedCount }
}
