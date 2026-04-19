/**
 * 增量导入模块
 * 处理将新的聊天记录追加到现有会话的功能
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import { streamParseFile, detectFormat } from '../../parser'
import { sendProgress, getDbPath } from './utils'
import { generateMessageKey } from './tempDb'

/** 导入选项（控制 meta/members 更新行为） */
export interface ImportOptions {
  metaUpdateMode?: 'patch' | 'none'
  memberUpdateMode?: 'upsert' | 'none'
}

/** 增量导入分析结果 */
export interface IncrementalAnalyzeResult {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  error?: string
}

/** 增量导入结果 */
interface ErrorSample {
  index: number
  reason: string
  detail: string
}

export interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
  batch?: {
    receivedCount: number
    writtenCount: number
    duplicateCount: number
    errorCount: number
    errorReasonCounts: Record<string, number>
    errorSample: ErrorSample[]
  }
  session?: {
    totalCount: number
    memberCount: number
    firstTimestamp: number
    lastTimestamp: number
  }
  updates?: {
    metaUpdated: boolean
    membersAdded: number
    membersUpdated: number
  }
}

/**
 * 加载现有消息的去重集合（双路径：platformMessageId 优先 + 内容哈希兜底）
 */
function loadExistingDedup(db: Database.Database): {
  existingPlatformMsgIds: Set<string>
  existingKeys: Set<string>
} {
  const existingPlatformMsgIds = new Set<string>()
  const existingKeys = new Set<string>()

  // 加载已有的 platformMessageId 集合
  const pmidRows = db
    .prepare('SELECT platform_message_id FROM message WHERE platform_message_id IS NOT NULL')
    .all() as Array<{ platform_message_id: string }>
  for (const row of pmidRows) {
    existingPlatformMsgIds.add(row.platform_message_id)
  }

  // 加载内容哈希集合（用于无 platformMessageId 的消息）
  const hashRows = db
    .prepare(
      `SELECT ts, m.platform_id as sender_platform_id, content
       FROM message msg
       JOIN member m ON msg.sender_id = m.id`
    )
    .all() as Array<{ ts: number; sender_platform_id: string; content: string | null }>
  for (const row of hashRows) {
    existingKeys.add(generateMessageKey(row.ts, row.sender_platform_id, row.content))
  }

  return { existingPlatformMsgIds, existingKeys }
}

/**
 * 双路径去重判断：platformMessageId 优先，内容哈希兜底
 * @returns true 表示是重复消息，应跳过
 */
function isDuplicate(
  msg: { platformMessageId?: string; timestamp: number; senderPlatformId: string; content: string | null },
  existingPlatformMsgIds: Set<string>,
  existingKeys: Set<string>
): boolean {
  if (msg.platformMessageId) {
    if (existingPlatformMsgIds.has(msg.platformMessageId)) return true
    existingPlatformMsgIds.add(msg.platformMessageId)
    return false
  }
  const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)
  if (existingKeys.has(key)) return true
  existingKeys.add(key)
  return false
}

/**
 * 分析增量导入（检测去重后能新增多少消息）
 */
export async function analyzeIncrementalImport(
  sessionId: string,
  filePath: string,
  requestId: string
): Promise<IncrementalAnalyzeResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { error: 'error.unrecognized_format', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return { error: 'error.session_not_found', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  const { existingPlatformMsgIds, existingKeys } = loadExistingDedup(db)
  db.close()

  let totalInFile = 0
  let newMessageCount = 0
  let duplicateCount = 0

  await streamParseFile(filePath, {
    onMeta: () => {},
    onMembers: () => {},
    onProgress: (progress) => {
      sendProgress(requestId, progress)
    },
    onMessageBatch: (batch) => {
      for (const msg of batch) {
        totalInFile++
        if (isDuplicate(msg, existingPlatformMsgIds, existingKeys)) {
          duplicateCount++
        } else {
          newMessageCount++
        }
      }
    },
  })

  return {
    newMessageCount,
    duplicateCount,
    totalInFile,
  }
}

/**
 * 执行增量导入
 */
export async function incrementalImport(
  sessionId: string,
  filePath: string,
  requestId: string,
  options?: ImportOptions
): Promise<IncrementalImportResult> {
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, newMessageCount: 0, error: 'error.unrecognized_format' }
  }

  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return { success: false, newMessageCount: 0, error: 'error.session_not_found' }
  }

  const metaUpdateMode = options?.metaUpdateMode ?? 'patch'
  const memberUpdateMode = options?.memberUpdateMode ?? 'upsert'

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  try {
    const { existingPlatformMsgIds, existingKeys } = loadExistingDedup(db)

    // 获取现有成员映射
    const memberIdMap = new Map<string, number>()
    const existingMembers = db.prepare('SELECT id, platform_id FROM member').all() as Array<{
      id: number
      platform_id: string
    }>
    const initialMemberCount = existingMembers.length
    for (const m of existingMembers) {
      memberIdMap.set(m.platform_id, m.id)
    }

    // members upsert：新增+更新（含 roles 列）
    const upsertMember = db.prepare(`
      INSERT INTO member (platform_id, account_name, group_nickname, avatar, roles)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(platform_id) DO UPDATE SET
        account_name = COALESCE(NULLIF(excluded.account_name, ''), account_name),
        group_nickname = COALESCE(NULLIF(excluded.group_nickname, ''), group_nickname),
        avatar = COALESCE(NULLIF(excluded.avatar, ''), avatar),
        roles = CASE WHEN excluded.roles != '[]' THEN excluded.roles ELSE roles END
    `)

    // 仅新增的 member 插入（用于消息中发现的未知 sender，无 roles 信息）
    const insertMemberMinimal = db.prepare(`
      INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname, avatar)
      VALUES (?, ?, ?, ?)
    `)

    const getMemberId = db.prepare('SELECT id FROM member WHERE platform_id = ?')

    const insertMessage = db.prepare(`
      INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, reply_to_message_id, platform_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    // meta 非空字段覆盖更新
    const updateMeta = db.prepare(`
      UPDATE meta SET
        name = COALESCE(NULLIF(?, ''), name),
        group_id = COALESCE(NULLIF(?, ''), group_id),
        group_avatar = COALESCE(NULLIF(?, ''), group_avatar),
        owner_id = COALESCE(NULLIF(?, ''), owner_id),
        imported_at = ?
    `)

    db.exec('BEGIN TRANSACTION')

    let newMessageCount = 0
    let duplicateCount = 0
    let processedCount = 0
    let metaUpdated = false
    let membersAdded = 0
    let membersUpdated = 0
    let errorCount = 0
    const errorReasonCounts: Record<string, number> = {}
    const errorSamples: ErrorSample[] = []
    const MAX_ERROR_SAMPLES = 5
    const BATCH_SIZE = 5000

    function trackError(index: number, reason: string, detail: string) {
      errorCount++
      errorReasonCounts[reason] = (errorReasonCounts[reason] || 0) + 1
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push({ index, reason, detail })
      }
    }

    const newFtsEntries: Array<{ id: number; content: string | null }> = []

    await streamParseFile(filePath, {
      onMeta: (meta) => {
        if (metaUpdateMode === 'none') return
        updateMeta.run(
          meta.name || '',
          meta.groupId || '',
          meta.groupAvatar || '',
          meta.ownerId || '',
          Math.floor(Date.now() / 1000)
        )
        metaUpdated = true
      },
      onMembers: (members) => {
        if (memberUpdateMode === 'none') return
        for (const m of members) {
          const existed = memberIdMap.has(m.platformId)
          upsertMember.run(
            m.platformId,
            m.accountName || null,
            m.groupNickname || null,
            m.avatar || null,
            m.roles ? JSON.stringify(m.roles) : '[]'
          )
          if (!existed) {
            const row = getMemberId.get(m.platformId) as { id: number } | undefined
            if (row) memberIdMap.set(m.platformId, row.id)
            membersAdded++
          } else {
            membersUpdated++
          }
        }
      },
      onProgress: (progress) => {
        sendProgress(requestId, progress)
      },
      onMessageBatch: (batch) => {
        for (const msg of batch) {
          processedCount++

          // Message validation
          if (!msg.senderPlatformId) {
            trackError(processedCount, 'MISSING_SENDER', 'sender field is empty')
            continue
          }
          if (msg.timestamp === undefined || msg.timestamp === null) {
            trackError(processedCount, 'MISSING_TIMESTAMP', 'timestamp field is missing')
            continue
          }
          if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0 || !isFinite(msg.timestamp)) {
            trackError(processedCount, 'INVALID_TIMESTAMP', `timestamp value: ${msg.timestamp}`)
            continue
          }

          if (isDuplicate(msg, existingPlatformMsgIds, existingKeys)) {
            duplicateCount++
            continue
          }

          let memberId = memberIdMap.get(msg.senderPlatformId)
          if (!memberId) {
            insertMemberMinimal.run(
              msg.senderPlatformId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              null
            )
            const row = getMemberId.get(msg.senderPlatformId) as { id: number } | undefined
            if (row) {
              memberId = row.id
              memberIdMap.set(msg.senderPlatformId, memberId)
              membersAdded++
            }
          }
          if (!memberId) continue

          const msgResult = insertMessage.run(
            memberId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            msg.content || null,
            msg.replyToMessageId || null,
            msg.platformMessageId || null
          )

          newFtsEntries.push({
            id: Number(msgResult.lastInsertRowid),
            content: msg.content || null,
          })
          newMessageCount++
        }

        if (processedCount % BATCH_SIZE === 0) {
          sendProgress(requestId, {
            stage: 'saving',
            bytesRead: 0,
            totalBytes: 0,
            messagesProcessed: processedCount,
            percentage: 50,
            message: `已处理 ${processedCount} 条，新增 ${newMessageCount} 条`,
          })
        }
      },
    })

    db.exec('COMMIT')

    // 若 onMeta 未触发但有新消息，仍需更新 imported_at
    if (!metaUpdated) {
      db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))
    }

    // 增量 FTS 更新
    if (newFtsEntries.length > 0) {
      try {
        const { insertFtsEntries } = await import('../query/fts')
        insertFtsEntries(sessionId, newFtsEntries)
      } catch {
        // FTS 更新失败不影响导入流程
      }
    }

    // 查询 session 统计信息（用于 v1 响应）
    const sessionStats = db
      .prepare(
        `SELECT
           COUNT(*) as totalCount,
           MIN(ts) as firstTimestamp,
           MAX(ts) as lastTimestamp
         FROM message`
      )
      .get() as { totalCount: number; firstTimestamp: number; lastTimestamp: number }
    const memberCountRow = db.prepare('SELECT COUNT(*) as count FROM member').get() as { count: number }

    // 写入概览统计缓存文件
    try {
      const { computeAndSetOverviewCache } = await import('../../database/sessionCache')
      const { getCacheDir } = await import('../core')
      computeAndSetOverviewCache(db, sessionId, getCacheDir())
    } catch {
      // 缓存写入失败不影响导入流程
    }

    db.close()

    sendProgress(requestId, {
      stage: 'done',
      bytesRead: 0,
      totalBytes: 0,
      messagesProcessed: processedCount,
      percentage: 100,
      message: `导入完成，新增 ${newMessageCount} 条消息`,
    })

    return {
      success: true,
      newMessageCount,
      batch: {
        receivedCount: processedCount,
        writtenCount: newMessageCount,
        duplicateCount,
        errorCount,
        errorReasonCounts,
        errorSample: errorSamples,
      },
      session: {
        totalCount: sessionStats.totalCount,
        memberCount: memberCountRow.count,
        firstTimestamp: sessionStats.firstTimestamp,
        lastTimestamp: sessionStats.lastTimestamp,
      },
      updates: {
        metaUpdated,
        membersAdded,
        membersUpdated,
      },
    }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore rollback error
    }
    db.close()

    console.error('[IncrementalImport] Error:', error)
    return { success: false, newMessageCount: 0, error: String(error) }
  }
}
