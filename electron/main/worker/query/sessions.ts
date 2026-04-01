/**
 * 会话管理查询模块
 * 负责会话列表与单会话基础信息查询
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { openDatabase, getDbDir, getDbPath } from '../core'

interface DbMeta {
  name: string
  platform: string
  type: string
  imported_at: number
  group_id: string | null
  group_avatar: string | null
  owner_id: string | null
}

/**
 * 判断是否为聊天会话数据库
 * 通过核心三表（meta/member/message）存在性快速识别
 */
function isChatSessionDb(db: Database.Database): boolean {
  const requiredTableCount = db
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('meta', 'member', 'message')")
    .get() as { cnt: number }
  return requiredTableCount.cnt === 3
}

/**
 * 获取私聊对方成员的头像
 * 逻辑参考 private-chat/index.vue 的 otherMemberAvatar
 */
function getPrivateChatMemberAvatar(db: Database.Database, sessionName: string, ownerId: string | null): string | null {
  // 获取所有非系统消息成员（按消息数排序）
  const members = db
    .prepare(
      `SELECT
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        m.avatar
      FROM member m
      WHERE COALESCE(m.account_name, '') != '系统消息'
      ORDER BY (SELECT COUNT(*) FROM message WHERE sender_id = m.id) DESC`
    )
    .all() as Array<{ platformId: string; name: string; avatar: string | null }>

  if (members.length === 0) return null

  // 1. 优先排除 ownerId，找到另一成员的头像
  if (ownerId) {
    const other = members.find((m) => m.platformId !== ownerId)
    if (other?.avatar) return other.avatar
  }

  // 2. 尝试匹配会话名称（私聊名称通常是对方昵称）
  const sameName = members.find((m) => m.name === sessionName)
  if (sameName?.avatar) return sameName.avatar

  // 3. 如果只有两个成员且有 ownerId，取另一个（即使没有头像也返回 null）
  // 如果没有 ownerId，返回第一个有头像的成员
  const firstWithAvatar = members.find((m) => m.avatar)
  return firstWithAvatar?.avatar || null
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

      // 跳过非聊天会话数据库（例如内部索引库）
      if (!isChatSessionDb(db)) {
        db.close()
        continue
      }

      const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined

      if (meta) {
        const messageCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count
             FROM message msg
             JOIN member m ON msg.sender_id = m.id
             WHERE COALESCE(m.account_name, '') != '系统消息'`
            )
            .get() as { count: number }
        ).count
        const memberCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count
             FROM member
             WHERE COALESCE(account_name, '') != '系统消息'`
            )
            .get() as { count: number }
        ).count

        // 私聊：获取对方成员头像
        let memberAvatar: string | null = null
        if (meta.type === 'private') {
          memberAvatar = getPrivateChatMemberAvatar(db, meta.name, meta.owner_id)
        }

        // 摘要数量：安全查询（chat_session 表可能不存在）
        let summaryCount = 0
        try {
          const hasChatSessionTable = db
            .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='chat_session'")
            .get() as { cnt: number }
          if (hasChatSessionTable.cnt > 0) {
            summaryCount = (
              db
                .prepare("SELECT COUNT(*) as count FROM chat_session WHERE summary IS NOT NULL AND summary != ''")
                .get() as { count: number }
            ).count
          }
        } catch {
          // 忽略查询错误
        }

        sessions.push({
          id: sessionId,
          name: meta.name,
          platform: meta.platform,
          type: meta.type,
          importedAt: meta.imported_at,
          messageCount,
          memberCount,
          dbPath,
          groupId: meta.group_id || null,
          groupAvatar: meta.group_avatar || null,
          ownerId: meta.owner_id || null,
          memberAvatar, // 私聊对方头像
          summaryCount,
          aiConversationCount: 0, // 将在 IPC 层由主进程填充
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

  const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined
  if (!meta) return null

  const messageCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE COALESCE(m.account_name, '') != '系统消息'`
      )
      .get() as { count: number }
  ).count

  const memberCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM member
         WHERE COALESCE(account_name, '') != '系统消息'`
      )
      .get() as { count: number }
  ).count

  return {
    id: sessionId,
    name: meta.name,
    platform: meta.platform,
    type: meta.type,
    importedAt: meta.imported_at,
    messageCount,
    memberCount,
    dbPath: getDbPath(sessionId),
    groupId: meta.group_id || null,
    groupAvatar: meta.group_avatar || null,
    ownerId: meta.owner_id || null,
  }
}
