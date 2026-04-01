/**
 * 导出功能模块
 * 提供将筛选结果导出为 Markdown 文件的功能
 */

import * as fs from 'fs'
import * as path from 'path'
import { parentPort } from 'worker_threads'
import { openReadonlyDatabase } from './core'
import type { ExportFilterParams, ExportProgress } from './types'

/**
 * 发送导出进度到主进程
 */
function sendExportProgress(requestId: string, progress: ExportProgress): void {
  parentPort?.postMessage({
    id: requestId,
    type: 'progress',
    payload: progress,
  })
}

/**
 * 导出筛选结果到 Markdown 文件（后端生成，支持大数据量）
 * 使用流式写入，避免内存溢出
 *
 * @param params 导出参数
 * @param requestId 请求 ID（用于发送进度）
 * @returns 生成的文件路径
 */
export function exportFilterResultToFile(
  params: ExportFilterParams,
  requestId?: string
): { success: boolean; filePath?: string; error?: string } {
  const db = openReadonlyDatabase(params.sessionId)
  if (!db) {
    return { success: false, error: '无法打开数据库' }
  }

  try {
    const timestamp = Date.now()
    const fileName = `${params.sessionName}_筛选结果_${timestamp}.md`
    const filePath = path.join(params.outputDir, fileName)

    // 创建写入流
    const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' })

    // 写入头部
    writeStream.write(`# ${params.sessionName} - 聊天记录筛选结果\n\n`)
    writeStream.write(`> 导出时间: ${new Date().toLocaleString()}\n\n`)

    // 写入筛选条件摘要
    writeStream.write(`## 筛选条件\n\n`)
    if (params.filterMode === 'condition') {
      if (params.keywords && params.keywords.length > 0) {
        writeStream.write(`- 关键词: ${params.keywords.join(', ')}\n`)
      }
      if (params.timeFilter) {
        const start = new Date(params.timeFilter.startTs * 1000).toLocaleString()
        const end = new Date(params.timeFilter.endTs * 1000).toLocaleString()
        writeStream.write(`- 时间范围: ${start} ~ ${end}\n`)
      }
      writeStream.write(`- 上下文扩展: ±${params.contextSize || 10} 条消息\n`)
    } else {
      writeStream.write(`- 模式: 会话筛选\n`)
      writeStream.write(`- 选中会话数: ${params.chatSessionIds?.length || 0}\n`)
    }
    writeStream.write('\n')

    let totalMessages = 0
    let totalHits = 0
    let totalChars = 0
    let blockIndex = 0

    if (params.filterMode === 'condition') {
      // 条件筛选模式：流式处理
      const contextSize = params.contextSize || 10

      // 第一阶段：获取命中消息的索引
      const lightweightSql = `
        SELECT
          id,
          ts,
          sender_id as senderId,
          content
        FROM message
        ${params.timeFilter ? 'WHERE ts >= ? AND ts <= ?' : ''}
        ORDER BY ts ASC, id ASC
      `
      const sqlParams: unknown[] = []
      if (params.timeFilter) {
        sqlParams.push(params.timeFilter.startTs, params.timeFilter.endTs)
      }

      const hitIndexes: number[] = []
      let msgIndex = 0
      const stmt = db.prepare(lightweightSql)

      for (const row of stmt.iterate(...sqlParams) as Iterable<{
        id: number
        ts: number
        senderId: number
        content: string | null
      }>) {
        let isHit = true

        if (params.keywords && params.keywords.length > 0) {
          const content = (row.content || '').toLowerCase()
          isHit = params.keywords.some((kw) => content.includes(kw.toLowerCase()))
        }

        if (isHit && params.senderIds && params.senderIds.length > 0) {
          isHit = params.senderIds.includes(row.senderId)
        }

        if (isHit) {
          hitIndexes.push(msgIndex)
        }
        msgIndex++
      }

      totalHits = hitIndexes.length

      // 发送准备阶段进度
      if (requestId) {
        sendExportProgress(requestId, {
          stage: 'preparing',
          currentBlock: 0,
          totalBlocks: 0,
          percentage: 10,
          message: `正在分析数据，找到 ${totalHits} 条匹配消息...`,
        })
      }

      if (hitIndexes.length === 0) {
        writeStream.write(`## 统计信息\n\n`)
        writeStream.write(`- 无匹配结果\n`)
        writeStream.end()
        if (requestId) {
          sendExportProgress(requestId, {
            stage: 'done',
            currentBlock: 0,
            totalBlocks: 0,
            percentage: 100,
            message: '导出完成（无匹配结果）',
          })
        }
        return { success: true, filePath }
      }

      // 计算上下文范围并合并
      const ranges: Array<{ start: number; end: number; hitIndexes: number[] }> = []
      const totalMsgCount = msgIndex

      for (const hitIdx of hitIndexes) {
        const start = Math.max(0, hitIdx - contextSize)
        const end = Math.min(totalMsgCount - 1, hitIdx + contextSize)

        if (ranges.length > 0) {
          const lastRange = ranges[ranges.length - 1]
          if (start <= lastRange.end + 1) {
            lastRange.end = Math.max(lastRange.end, end)
            lastRange.hitIndexes.push(hitIdx)
            continue
          }
        }
        ranges.push({ start, end, hitIndexes: [hitIdx] })
      }

      const totalBlocks = ranges.length

      // 发送开始导出进度
      if (requestId) {
        sendExportProgress(requestId, {
          stage: 'exporting',
          currentBlock: 0,
          totalBlocks,
          percentage: 15,
          message: `开始导出 ${totalBlocks} 个对话块...`,
        })
      }

      // 写入统计信息
      writeStream.write(`## 统计信息\n\n`)
      writeStream.write(`- 对话块数: ${totalBlocks}\n`)
      writeStream.write(`- 命中消息: ${totalHits}\n\n`)

      // 第二阶段：流式写入每个块的内容
      writeStream.write(`## 对话内容\n\n`)

      for (const range of ranges) {
        blockIndex++

        // 发送导出进度（每个块）
        if (requestId) {
          const percentage = Math.round(15 + ((blockIndex - 1) / totalBlocks) * 80)
          sendExportProgress(requestId, {
            stage: 'exporting',
            currentBlock: blockIndex,
            totalBlocks,
            percentage,
            message: `正在导出对话块 ${blockIndex}/${totalBlocks}...`,
          })
        }

        const blockSql = `
          SELECT
            msg.id,
            msg.ts,
            COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
            msg.content
          FROM message msg
          JOIN member m ON msg.sender_id = m.id
          ${params.timeFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''}
          ORDER BY msg.ts ASC, msg.id ASC
          LIMIT ? OFFSET ?
        `
        const blockParams: unknown[] = []
        if (params.timeFilter) {
          blockParams.push(params.timeFilter.startTs, params.timeFilter.endTs)
        }
        blockParams.push(range.end - range.start + 1, range.start)

        const messages = db.prepare(blockSql).all(...blockParams) as Array<{
          id: number
          ts: number
          senderName: string
          content: string | null
        }>

        if (messages.length === 0) continue

        const hitIndexSet = new Set(range.hitIndexes.map((idx) => idx - range.start))

        const startTime = new Date(messages[0].ts * 1000).toLocaleString()
        const endTime = new Date(messages[messages.length - 1].ts * 1000).toLocaleString()
        writeStream.write(`### 对话块 ${blockIndex} (${startTime} ~ ${endTime})\n\n`)

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          const time = new Date(msg.ts * 1000).toLocaleTimeString()
          const hitMark = hitIndexSet.has(i) ? ' ⭐' : ''
          const content = msg.content || '[非文本消息]'
          writeStream.write(`${time} ${msg.senderName}${hitMark}: ${content}\n`)
          totalMessages++
          totalChars += (msg.content || '').length
        }
        writeStream.write('\n')
      }
    } else {
      // 会话筛选模式
      if (!params.chatSessionIds || params.chatSessionIds.length === 0) {
        writeStream.write(`## 统计信息\n\n`)
        writeStream.write(`- 未选择会话\n`)
        writeStream.end()
        if (requestId) {
          sendExportProgress(requestId, {
            stage: 'done',
            currentBlock: 0,
            totalBlocks: 0,
            percentage: 100,
            message: '导出完成（未选择会话）',
          })
        }
        return { success: true, filePath }
      }

      // 发送准备阶段进度
      if (requestId) {
        sendExportProgress(requestId, {
          stage: 'preparing',
          currentBlock: 0,
          totalBlocks: params.chatSessionIds.length,
          percentage: 10,
          message: `正在准备导出 ${params.chatSessionIds.length} 个会话...`,
        })
      }

      // 获取会话信息
      const sessionsSql = `
        SELECT id, start_ts as startTs, end_ts as endTs
        FROM chat_session
        WHERE id IN (${params.chatSessionIds.map(() => '?').join(',')})
        ORDER BY start_ts ASC
      `
      const sessions = db.prepare(sessionsSql).all(...params.chatSessionIds) as Array<{
        id: number
        startTs: number
        endTs: number
      }>

      const totalBlocks = sessions.length

      writeStream.write(`## 统计信息\n\n`)
      writeStream.write(`- 对话块数: ${totalBlocks}\n\n`)

      writeStream.write(`## 对话内容\n\n`)

      const messagesSql = `
        SELECT
          msg.id,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
          msg.content,
          msg.ts as timestamp
        FROM message_context mc
        JOIN message msg ON msg.id = mc.message_id
        JOIN member m ON msg.sender_id = m.id
        WHERE mc.session_id = ?
        ORDER BY msg.ts ASC
      `

      for (const session of sessions) {
        blockIndex++

        // 发送导出进度（每个会话）
        if (requestId) {
          const percentage = Math.round(15 + ((blockIndex - 1) / totalBlocks) * 80)
          sendExportProgress(requestId, {
            stage: 'exporting',
            currentBlock: blockIndex,
            totalBlocks,
            percentage,
            message: `正在导出会话 ${blockIndex}/${totalBlocks}...`,
          })
        }

        const messages = db.prepare(messagesSql).all(session.id) as Array<{
          id: number
          senderName: string
          content: string | null
          timestamp: number
        }>

        if (messages.length === 0) continue

        const startTime = new Date(session.startTs * 1000).toLocaleString()
        const endTime = new Date(session.endTs * 1000).toLocaleString()
        writeStream.write(`### 对话块 ${blockIndex} (${startTime} ~ ${endTime})\n\n`)

        for (const msg of messages) {
          const time = new Date(msg.timestamp * 1000).toLocaleTimeString()
          const content = msg.content || '[非文本消息]'
          writeStream.write(`${time} ${msg.senderName}: ${content}\n`)
          totalMessages++
          totalChars += (msg.content || '').length
        }
        writeStream.write('\n')
      }
    }

    writeStream.end()

    // 发送完成进度
    if (requestId) {
      sendExportProgress(requestId, {
        stage: 'done',
        currentBlock: blockIndex,
        totalBlocks: blockIndex,
        percentage: 100,
        message: `导出完成，共 ${blockIndex} 个对话块`,
      })
    }

    return { success: true, filePath }
  } catch (error) {
    console.error('exportFilterResultToFile error:', error)
    // 发送错误进度
    if (requestId) {
      sendExportProgress(requestId, {
        stage: 'error',
        currentBlock: 0,
        totalBlocks: 0,
        percentage: 0,
        message: `导出失败: ${String(error)}`,
      })
    }
    return { success: false, error: String(error) }
  } finally {
    db.close()
  }
}
