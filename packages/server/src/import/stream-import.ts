/**
 * 流式导入：使用 @openchatlab/parser 解析 + importer 写入
 *
 * 支持所有 14+ 格式（QQ/WeChat/Telegram/WhatsApp/LINE/Discord/Instagram 等），
 * 替代原有仅支持 ChatLab JSON/JSONL 的管线。
 */

import type { DatabaseManager } from '@openchatlab/node-runtime'
import { openBetterSqliteDatabase } from '@openchatlab/node-runtime'
import { CHAT_DB_SCHEMA, FTS_TABLE_SCHEMA, buildMemberIdMap } from '@openchatlab/core'
import {
  streamParseFile,
  detectFormat as parserDetectFormat,
  detectAllFormats,
  getFormatFeatureById,
  getSupportedFormats as parserGetSupportedFormats,
  scanMultiChatFile as parserScanMultiChatFile,
  type ParsedMeta,
  type ParsedMember,
  type ParsedMessage,
  type ParseProgress,
  type FormatFeature,
  type MultiChatInfo,
} from '@openchatlab/parser'
import * as fs from 'fs'
import * as crypto from 'crypto'

export interface StreamImportProgress {
  stage: 'detecting' | 'parsing' | 'saving' | 'indexing' | 'done' | 'error'
  progress: number
  message: string
  bytesRead?: number
  totalBytes?: number
  messagesProcessed?: number
}

export interface StreamImportResult {
  success: boolean
  sessionId?: string
  error?: string
  messageCount?: number
  memberCount?: number
}

export interface StreamImportOptions {
  formatId?: string
  chatIndex?: number
  nativeBinding?: string
  onProgress?: (progress: StreamImportProgress) => void
}

function generateSessionId(): string {
  const ts = Date.now()
  const rand = crypto.randomBytes(4).toString('hex')
  return `chat_${ts}_${rand}`
}

/**
 * 流式导入：解析文件并写入数据库
 */
export async function streamImport(
  dbManager: DatabaseManager,
  filePath: string,
  options?: StreamImportOptions
): Promise<StreamImportResult> {
  const { formatId, chatIndex, nativeBinding, onProgress } = options || {}

  onProgress?.({ stage: 'detecting', progress: 5, message: '' })

  let meta: ParsedMeta | null = null
  const members: ParsedMember[] = []
  const messages: ParsedMessage[] = []

  const formatOptions: Record<string, unknown> = {}
  if (chatIndex !== undefined) formatOptions.chatIndex = chatIndex

  try {
    await streamParseFile(
      filePath,
      {
        onProgress: (p: ParseProgress) => {
          onProgress?.({
            stage: 'parsing',
            progress: Math.min(Math.round(p.percentage * 0.7), 70),
            message: '',
            bytesRead: p.bytesRead,
            totalBytes: p.totalBytes,
            messagesProcessed: p.messagesProcessed,
          })
        },
        onMeta: (m) => {
          meta = m
        },
        onMembers: (m) => {
          members.push(...m)
        },
        onMessageBatch: (m) => {
          messages.push(...m)
        },
        formatOptions,
      },
      formatId
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onProgress?.({ stage: 'error', progress: 0, message: msg })
    return { success: false, error: msg }
  }

  if (!meta) {
    const msg = 'Parse failed: no meta information received'
    onProgress?.({ stage: 'error', progress: 0, message: msg })
    return { success: false, error: msg }
  }

  const parsedMeta = meta as ParsedMeta

  onProgress?.({ stage: 'saving', progress: 75, message: '' })

  const sessionId = generateSessionId()
  const dbPath = dbManager.getDbPath(sessionId)

  let db: ReturnType<typeof openBetterSqliteDatabase> | null = null
  try {
    db = openBetterSqliteDatabase(dbPath, { nativeBinding })
    db.exec(CHAT_DB_SCHEMA)

    db!
      .prepare(
        `INSERT INTO meta (name, platform, type, imported_at, group_id, group_avatar, owner_id, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 4)`
      )
      .run(
        parsedMeta.name,
        parsedMeta.platform,
        parsedMeta.type,
        Math.floor(Date.now() / 1000),
        parsedMeta.groupId || null,
        parsedMeta.groupAvatar || null,
        parsedMeta.ownerId || null
      )

    const insertMember = db.prepare(
      `INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar, roles)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const m of members) {
      insertMember.run(
        m.platformId,
        m.accountName || m.platformId,
        m.groupNickname || null,
        m.avatar || null,
        m.roles ? JSON.stringify(m.roles) : '[]'
      )
    }

    const memberIdMap = buildMemberIdMap(db)

    const insertMsg = db.prepare(
      `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    let written = 0
    const BATCH = 5000

    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH)
      db.transaction(() => {
        for (const msg of batch) {
          let senderId = memberIdMap.get(msg.senderPlatformId)
          if (!senderId) {
            insertMember.run(
              msg.senderPlatformId,
              msg.senderAccountName || msg.senderPlatformId,
              msg.senderGroupNickname || null,
              null,
              '[]'
            )
            senderId = (
              db!.prepare('SELECT id FROM member WHERE platform_id = ?').get(msg.senderPlatformId) as { id: number }
            )?.id
            if (senderId) memberIdMap.set(msg.senderPlatformId, senderId)
          }
          if (!senderId) continue

          insertMsg.run(
            senderId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            msg.content,
            msg.replyToMessageId || null,
            msg.platformMessageId || null
          )
          written++
        }
      })

      const pct = 75 + Math.round((Math.min(i + BATCH, messages.length) / messages.length) * 15)
      onProgress?.({ stage: 'saving', progress: pct, message: '', messagesProcessed: written })
    }

    onProgress?.({ stage: 'indexing', progress: 92, message: '' })

    db.exec(FTS_TABLE_SCHEMA)
    const textMessages = db
      .prepare("SELECT id, content FROM message WHERE type = 0 AND content IS NOT NULL AND content != ''")
      .all() as Array<{ id: number; content: string }>

    const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')
    for (let i = 0; i < textMessages.length; i += BATCH) {
      const batch = textMessages.slice(i, i + BATCH)
      db.transaction(() => {
        for (const row of batch) {
          insertFts.run(row.id, row.content)
        }
      })
    }

    db.close()

    onProgress?.({ stage: 'done', progress: 100, message: '' })

    return {
      success: true,
      sessionId,
      messageCount: written,
      memberCount: members.length,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      db?.close()
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(dbPath)
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(dbPath + '-wal')
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(dbPath + '-shm')
    } catch {
      /* ignore */
    }
    onProgress?.({ stage: 'error', progress: 0, message: msg })
    return { success: false, error: msg }
  }
}

export {
  parserDetectFormat as detectFormat,
  detectAllFormats,
  getFormatFeatureById,
  parserGetSupportedFormats as getSupportedFormats,
  parserScanMultiChatFile as scanMultiChatFile,
}
export type { FormatFeature, MultiChatInfo, ParseProgress }
