/**
 * 增量导入模块
 * 处理将新的聊天记录追加到现有会话的功能
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import { streamParseFile, detectFormat } from '../../parser'
import { sendProgress, getDbPath } from './utils'
import { generateMessageKey } from './tempDb'

/** 增量导入分析结果 */
export interface IncrementalAnalyzeResult {
  newMessageCount: number
  duplicateCount: number
  totalInFile: number
  error?: string
}

/** 增量导入结果 */
export interface IncrementalImportResult {
  success: boolean
  newMessageCount: number
  error?: string
}

/**
 * 分析增量导入（检测去重后能新增多少消息）
 */
export async function analyzeIncrementalImport(
  sessionId: string,
  filePath: string,
  requestId: string
): Promise<IncrementalAnalyzeResult> {
  // 检测文件格式
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { error: 'error.unrecognized_format', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  // 打开目标数据库获取现有消息的 key 集合
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return { error: 'error.session_not_found', newMessageCount: 0, duplicateCount: 0, totalInFile: 0 }
  }

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  // 获取现有消息的 key 集合
  const existingKeys = new Set<string>()
  const rows = db
    .prepare(
      `
    SELECT ts, m.platform_id as sender_platform_id, content
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
  `
    )
    .all() as Array<{ ts: number; sender_platform_id: string; content: string | null }>

  for (const row of rows) {
    existingKeys.add(generateMessageKey(row.ts, row.sender_platform_id, row.content))
  }

  db.close()

  // 解析新文件，统计新消息数
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
        const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)
        if (existingKeys.has(key)) {
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
  requestId: string
): Promise<IncrementalImportResult> {
  // 检测文件格式
  const formatFeature = detectFormat(filePath)
  if (!formatFeature) {
    return { success: false, newMessageCount: 0, error: 'error.unrecognized_format' }
  }

  // 打开目标数据库
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    return { success: false, newMessageCount: 0, error: 'error.session_not_found' }
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  try {
    // 获取现有消息的 key 集合
    const existingKeys = new Set<string>()
    const rows = db
      .prepare(
        `
      SELECT ts, m.platform_id as sender_platform_id, content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
    `
      )
      .all() as Array<{ ts: number; sender_platform_id: string; content: string | null }>

    for (const row of rows) {
      existingKeys.add(generateMessageKey(row.ts, row.sender_platform_id, row.content))
    }

    // 获取现有成员映射
    const memberIdMap = new Map<string, number>()
    const existingMembers = db.prepare('SELECT id, platform_id FROM member').all() as Array<{
      id: number
      platform_id: string
    }>
    for (const m of existingMembers) {
      memberIdMap.set(m.platform_id, m.id)
    }

    // 准备插入语句
    const insertMember = db.prepare(`
      INSERT INTO member (platform_id, account_name, group_nickname, avatar)
      VALUES (?, ?, ?, ?)
    `)

    const insertMessage = db.prepare(`
      INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // 开始事务
    db.exec('BEGIN TRANSACTION')

    let newMessageCount = 0
    let processedCount = 0
    const BATCH_SIZE = 5000

    // 解析新文件并写入
    await streamParseFile(filePath, {
      onMeta: () => {},
      onMembers: (members) => {
        // 添加新成员
        for (const m of members) {
          if (!memberIdMap.has(m.platformId)) {
            const result = insertMember.run(
              m.platformId,
              m.accountName || null,
              m.groupNickname || null,
              m.avatar || null
            )
            memberIdMap.set(m.platformId, result.lastInsertRowid as number)
          }
        }
      },
      onProgress: (progress) => {
        sendProgress(requestId, progress)
      },
      onMessageBatch: (batch) => {
        for (const msg of batch) {
          processedCount++
          const key = generateMessageKey(msg.timestamp, msg.senderPlatformId, msg.content)

          // 跳过重复消息
          if (existingKeys.has(key)) {
            continue
          }

          // 确保成员存在
          let memberId = memberIdMap.get(msg.senderPlatformId)
          if (!memberId) {
            const result = insertMember.run(
              msg.senderPlatformId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              null
            )
            memberId = result.lastInsertRowid as number
            memberIdMap.set(msg.senderPlatformId, memberId)
          }

          // 插入消息
          insertMessage.run(
            memberId,
            msg.senderAccountName || null,
            msg.senderGroupNickname || null,
            msg.timestamp,
            msg.type,
            msg.content || null
          )

          // 添加到已有 key 集合（防止文件内重复）
          existingKeys.add(key)
          newMessageCount++
        }

        // 定期发送进度
        if (processedCount % BATCH_SIZE === 0) {
          sendProgress(requestId, {
            stage: 'saving',
            bytesRead: 0,
            totalBytes: 0,
            messagesProcessed: processedCount,
            percentage: 50, // 实际进度难以计算，使用固定值
            message: `已处理 ${processedCount} 条，新增 ${newMessageCount} 条`,
          })
        }
      },
    })

    // 提交事务
    db.exec('COMMIT')

    // 更新 imported_at 时间
    db.prepare('UPDATE meta SET imported_at = ?').run(Math.floor(Date.now() / 1000))

    // 重建 FTS5 索引（增量导入后需要重建以包含新消息）
    if (newMessageCount > 0) {
      try {
        const { rebuildFtsIndex } = await import('../query/fts')
        rebuildFtsIndex(sessionId)
      } catch {
        // FTS 重建失败不影响导入流程
      }
    }

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

    return { success: true, newMessageCount }
  } catch (error) {
    // 回滚事务
    try {
      db.exec('ROLLBACK')
    } catch {
      // 忽略回滚错误
    }
    db.close()

    console.error('[IncrementalImport] Error:', error)
    return { success: false, newMessageCount: 0, error: String(error) }
  }
}
