/**
 * 聊天记录合并模块
 * 支持多个聊天记录文件合并为 ChatLab 专属格式
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { parseFileSync, detectFormat } from '../parser'
import { importData } from '../database/core'
import { TempDbReader } from './tempCache'
import { getDownloadsDir } from '../paths'
import type { ParseResult, ParsedMessage, ChatPlatform, ChatType, ParsedMember } from '../../../src/types/base'
import type {
  ChatLabFormat,
  ChatLabMember,
  ChatLabMessage,
  FileParseInfo,
  MergeConflict,
  ConflictCheckResult,
  MergeParams,
  MergeResult,
  MergeSource,
} from '../../../src/types/format'
import type { ParsedMeta } from '../parser/types'

/**
 * 获取默认输出目录（系统下载目录）
 */
function getDefaultOutputDir(): string {
  return getDownloadsDir()
}

/**
 * 确保输出目录存在
 */
function ensureOutputDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 生成输出文件名
 */
function generateOutputFilename(name: string, format: 'json' | 'jsonl' = 'json'): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeName = name.replace(/[/\\?%*:|"<>]/g, '_')
  return `${safeName}_merged_${date}.${format}`
}

/**
 * 解析文件获取基本信息（用于预览）
 * 注意：推荐使用 parser.parseFileInfo 获取更详细的信息
 */
export async function parseFileInfo(filePath: string): Promise<FileParseInfo> {
  const format = detectFormat(filePath)
  if (!format) {
    throw new Error('无法识别文件格式')
  }

  const result = await parseFileSync(filePath)

  return {
    name: result.meta.name,
    format: format.name,
    platform: result.meta.platform,
    messageCount: result.messages.length,
    memberCount: result.members.length,
  }
}

/**
 * 生成消息的唯一标识（用于去重和冲突检测）
 */
function getMessageKey(msg: ParsedMessage): string {
  // 合并链路的去重语义需要和增量导入保持一致，否则两条链路会对重复消息得出不同结论。
  const normalizedContent = msg.content || null
  const hash = createHash('sha256')
  hash.update(String(msg.timestamp))
  hash.update('\0')
  hash.update(msg.senderPlatformId)
  hash.update('\0')
  hash.update(normalizedContent === null ? 'null' : 'text')
  hash.update('\0')
  if (normalizedContent !== null) {
    hash.update(normalizedContent)
  }
  return hash.digest('base64url')
}

function getParsedMessageDisplayName(msg: ParsedMessage): string {
  return msg.senderGroupNickname || msg.senderAccountName || msg.senderPlatformId
}

/**
 * 检查消息是否是纯图片消息
 * 纯图片消息格式如：[图片: xxx.jpg]、[图片: {xxx}.jpg] 等
 */
function isImageOnlyMessage(content: string | undefined): boolean {
  if (!content) return false
  // 匹配 [图片: xxx] 格式，允许各种图片名称格式
  return /^\[图片:\s*.+\]$/.test(content.trim())
}

function detectConflictsInMessages(
  allMessages: Array<{ msg: ParsedMessage; source: string }>,
  conflicts: MergeConflict[]
): ConflictCheckResult {
  // 按时间戳分组检测冲突
  const timeGroups = new Map<number, Array<{ msg: ParsedMessage; source: string }>>()
  for (const item of allMessages) {
    const ts = item.msg.timestamp
    if (!timeGroups.has(ts)) {
      timeGroups.set(ts, [])
    }
    timeGroups.get(ts)!.push(item)
  }
  console.log(`[Merger] Unique timestamps: ${timeGroups.size}`)

  // 统计有多条消息的时间戳
  let multiMsgTsCount = 0
  for (const [, items] of timeGroups) {
    if (items.length > 1) multiMsgTsCount++
  }
  console.log(`[Merger] Timestamps with multiple messages: ${multiMsgTsCount}`)

  // 统计自动去重数量
  let autoDeduplicatedCount = 0

  // 检测每个时间戳内的冲突
  for (const [ts, items] of timeGroups) {
    if (items.length < 2) continue

    // 按发送者分组
    const senderGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
    for (const item of items) {
      const sender = item.msg.senderPlatformId
      if (!senderGroups.has(sender)) {
        senderGroups.set(sender, [])
      }
      senderGroups.get(sender)!.push(item)
    }

    // 检测同一时间戳同一发送者的不同内容
    for (const [sender, senderItems] of senderGroups) {
      if (senderItems.length < 2) continue

      // 检查是否来自不同文件
      const sources = new Set(senderItems.map((it) => it.source))
      if (sources.size < 2) {
        // 所有消息来自同一个文件，跳过（这是同一文件内同一秒内多条消息的情况）
        continue
      }

      // 按内容分组（完全相同的内容会被分到一组，自动去重）
      const contentGroups = new Map<string, Array<{ msg: ParsedMessage; source: string }>>()
      for (const item of senderItems) {
        const content = item.msg.content || ''
        if (!contentGroups.has(content)) {
          contentGroups.set(content, [])
        }
        contentGroups.get(content)!.push(item)
      }

      // 统计自动去重的消息（内容完全相同但来自不同文件）
      for (const [, contentItems] of contentGroups) {
        if (contentItems.length > 1) {
          const contentSources = new Set(contentItems.map((it) => it.source))
          if (contentSources.size > 1) {
            // 内容相同但来自不同文件，自动去重
            autoDeduplicatedCount += contentItems.length - 1
          }
        }
      }

      // 只有当有多个不同内容时才是真正的冲突
      if (contentGroups.size > 1) {
        const contentEntries = Array.from(contentGroups.entries())

        // 检查这些不同内容是否来自不同文件
        for (let i = 0; i < contentEntries.length - 1; i++) {
          for (let j = i + 1; j < contentEntries.length; j++) {
            const [content1, items1] = contentEntries[i]
            const [content2, items2] = contentEntries[j]

            // 找到两个来源不同的消息
            const item1 = items1[0]
            const item2 = items2.find((it) => it.source !== item1.source)

            // 如果找不到来自不同文件的消息，跳过
            if (!item2) continue

            // 如果两边都是纯图片消息，自动跳过（不需要用户选择）
            if (isImageOnlyMessage(content1) && isImageOnlyMessage(content2)) {
              autoDeduplicatedCount++
              continue
            }

            // 打印冲突详情
            if (conflicts.length < 5) {
              console.log(`[Merger] Conflict #${conflicts.length + 1}:`)
              console.log(`  Timestamp: ${ts} (${new Date(ts * 1000).toLocaleString()})`)
              console.log(`  Sender: ${sender} (${getParsedMessageDisplayName(item1.msg)})`)
              console.log(
                `  File1: ${item1.source}, length: ${content1.length}, content: "${content1.slice(0, 50)}..."`
              )
              console.log(
                `  File2: ${item2.source}, length: ${content2.length}, content: "${content2.slice(0, 50)}..."`
              )
            }

            conflicts.push({
              id: `conflict_${ts}_${sender}_${conflicts.length}`,
              timestamp: ts,
              sender: getParsedMessageDisplayName(item1.msg) || sender,
              contentLength1: content1.length,
              contentLength2: content2.length,
              content1: content1,
              content2: content2,
            })
          }
        }
      }
    }
  }

  console.log(`[Merger] Auto-deduplicated messages (incl. image conflicts): ${autoDeduplicatedCount}`)

  console.log(`[Merger] Conflicts detected: ${conflicts.length}`)

  // 计算去重后的消息数
  const uniqueKeys = new Set<string>()
  for (const item of allMessages) {
    uniqueKeys.add(getMessageKey(item.msg))
  }
  console.log(`[Merger] Messages after dedup: ${uniqueKeys.size}`)

  return {
    conflicts,
    totalMessages: uniqueKeys.size,
  }
}

/**
 * 合并多个聊天记录文件（使用缓存的解析结果）
 */
export async function mergeFilesWithCache(params: MergeParams, cache: Map<string, ParseResult>): Promise<MergeResult> {
  try {
    const { filePaths, outputName, outputDir, conflictResolutions, andAnalyze } = params

    console.log('[Merger] mergeFilesWithCache: Starting merge')
    console.log(
      '[Merger] 缓存状态:',
      filePaths.map((p) => `${path.basename(p)}: ${cache.has(p) ? '已缓存' : '未缓存'}`)
    )

    // 解析所有文件（优先使用缓存）
    const parseResults: Array<{ result: ParseResult; source: string }> = []
    for (const filePath of filePaths) {
      let result: ParseResult
      if (cache.has(filePath)) {
        result = cache.get(filePath)!
        console.log(`[Merger] Cache hit: ${path.basename(filePath)}`)
      } else {
        // 回退到文件解析（兼容性）
        console.log(`[Merger] Cache miss, re-parsing: ${path.basename(filePath)}`)
        result = await parseFileSync(filePath)
      }
      parseResults.push({ result, source: path.basename(filePath) })
    }

    return executeMerge(parseResults, outputName, outputDir, conflictResolutions, andAnalyze)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  }
}

async function executeMerge(
  parseResults: Array<{ result: ParseResult; source: string }>,
  outputName: string,
  outputDir: string | undefined,
  _conflictResolutions: MergeParams['conflictResolutions'],
  andAnalyze: boolean
): Promise<MergeResult> {
  const memberMap = new Map<string, ChatLabMember>()
  for (const { result } of parseResults) {
    for (const member of result.members) {
      const existing = memberMap.get(member.platformId)
      if (existing) {
        if (member.accountName) existing.accountName = member.accountName
        if (member.groupNickname) existing.groupNickname = member.groupNickname
        if (member.avatar) existing.avatar = member.avatar
      } else {
        memberMap.set(member.platformId, {
          platformId: member.platformId,
          accountName: member.accountName,
          groupNickname: member.groupNickname,
          avatar: member.avatar,
        })
      }
    }
  }

  const seenKeys = new Set<string>()
  const mergedMessages: ChatLabMessage[] = []
  for (const { result } of parseResults) {
    for (const msg of result.messages) {
      const key = getMessageKey(msg)
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      mergedMessages.push({
        sender: msg.senderPlatformId,
        accountName: msg.senderAccountName,
        groupNickname: msg.senderGroupNickname,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
      })
    }
  }

  mergedMessages.sort((a, b) => a.timestamp - b.timestamp)

  const sources: MergeSource[] = parseResults.map(({ result, source }) => ({
    filename: source,
    platform: result.meta.platform,
    messageCount: result.messages.length,
  }))

  const groupIds = new Set(parseResults.map(({ result }) => result.meta.groupId).filter(Boolean))
  const groupId =
    groupIds.size === 1 ? parseResults.find(({ result }) => result.meta.groupId)?.result.meta.groupId : undefined
  const groupAvatar = groupId
    ? parseResults.filter(({ result }) => result.meta.groupId === groupId).pop()?.result.meta.groupAvatar
    : undefined

  const chatLabHeader = {
    version: '0.0.1',
    exportedAt: Math.floor(Date.now() / 1000),
    generator: 'ChatLab Merge Tool',
    description: `合并自 ${parseResults.length} 个文件`,
  }

  const chatLabMeta = {
    name: outputName,
    platform: parseResults[0].result.meta.platform as ChatPlatform,
    type: parseResults[0].result.meta.type as ChatType,
    sources,
    groupId,
    groupAvatar,
  }

  const targetDir = outputDir || getDefaultOutputDir()
  ensureOutputDir(targetDir)
  const outputPath = path.join(targetDir, generateOutputFilename(outputName, 'json'))

  const chatLabData: ChatLabFormat = {
    chatlab: chatLabHeader,
    meta: chatLabMeta,
    members: Array.from(memberMap.values()),
    messages: mergedMessages,
  }
  fs.writeFileSync(outputPath, JSON.stringify(chatLabData, null, 2), 'utf-8')

  let sessionId: string | undefined
  if (andAnalyze) {
    sessionId = importData({
      meta: {
        name: chatLabMeta.name,
        platform: chatLabMeta.platform,
        type: chatLabMeta.type,
        groupId: chatLabMeta.groupId,
        groupAvatar: chatLabMeta.groupAvatar,
      },
      members: chatLabData.members.map((member) => ({
        platformId: member.platformId,
        accountName: member.accountName,
        groupNickname: member.groupNickname,
        avatar: member.avatar,
      })),
      messages: chatLabData.messages.map((msg) => ({
        senderPlatformId: msg.sender,
        senderAccountName: msg.accountName,
        senderGroupNickname: msg.groupNickname,
        timestamp: msg.timestamp,
        type: msg.type,
        content: msg.content,
      })),
    })
  }

  return {
    success: true,
    outputPath,
    sessionId,
  }
}

// ==================== 临时数据库版本（内存优化） ====================

/**
 * 检测合并冲突（使用临时数据库，内存友好）
 */
export async function checkConflictsWithTempDb(
  filePaths: string[],
  tempDbCache: Map<string, string>
): Promise<ConflictCheckResult> {
  const allMessages: Array<{ msg: ParsedMessage; source: string }> = []
  const conflicts: MergeConflict[] = []

  console.log('[Merger] checkConflictsWithTempDb: Checking conflicts')
  console.log(
    '[Merger] 文件列表:',
    filePaths.map((p) => path.basename(p))
  )
  console.log(
    '[Merger] 临时数据库缓存状态:',
    filePaths.map((p) => `${path.basename(p)}: ${tempDbCache.has(p) ? '已缓存' : '未缓存'}`)
  )

  // 从临时数据库读取所有消息
  const readers: TempDbReader[] = []
  try {
    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`未找到文件的临时数据库: ${path.basename(filePath)}`)
      }

      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)

      const meta = reader.getMeta()
      const sourceName = path.basename(filePath)

      console.log(`[Merger] Reading from temp DB: ${sourceName}, platform: ${meta?.platform}`)

      // 流式读取消息，避免一次性加载到内存
      reader.streamMessages(10000, (messages) => {
        for (const msg of messages) {
          allMessages.push({ msg, source: sourceName })
        }
      })
    }

    console.log(`[Merger] Total messages: ${allMessages.length}`)

    // 检查格式一致性
    const platforms = readers.map((r) => r.getMeta()?.platform || 'unknown')
    const uniquePlatforms = [...new Set(platforms)]
    if (uniquePlatforms.length > 1) {
      throw new Error(
        `不支持合并不同格式的聊天记录。\n检测到的格式：${uniquePlatforms.join('、')}\n请确保所有文件使用相同的导出工具和格式。`
      )
    }
    console.log('[Merger] Format check passed:', uniquePlatforms[0])

    return detectConflictsInMessages(allMessages, conflicts)
  } finally {
    // 关闭所有 reader
    for (const reader of readers) {
      reader.close()
    }
  }
}

/**
 * 合并多个聊天记录文件（使用临时数据库，内存友好）
 */
export async function mergeFilesWithTempDb(
  params: MergeParams,
  tempDbCache: Map<string, string>
): Promise<MergeResult> {
  const {
    filePaths,
    outputName,
    outputDir,
    outputFormat = 'json',
    conflictResolutions: _conflictResolutions,
    andAnalyze,
  } = params

  console.log('[Merger] mergeFilesWithTempDb: Starting merge')
  console.log(
    '[Merger] 临时数据库缓存状态:',
    filePaths.map((p) => `${path.basename(p)}: ${tempDbCache.has(p) ? '已缓存' : '未缓存'}`)
  )

  const readers: TempDbReader[] = []

  try {
    // 打开所有临时数据库
    const parseResults: Array<{ meta: ParsedMeta; members: ParsedMember[]; source: string; reader: TempDbReader }> = []

    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`未找到文件的临时数据库: ${path.basename(filePath)}`)
      }

      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)

      const meta = reader.getMeta()
      if (!meta) {
        throw new Error(`无法读取元信息: ${path.basename(filePath)}`)
      }

      const members = reader.getMembers()
      const sourceName = path.basename(filePath)

      console.log(`[Merger] Using temp database: ${sourceName}`)

      parseResults.push({ meta, members, source: sourceName, reader })
    }

    // 合并成员
    const memberMap = new Map<string, ChatLabMember>()
    for (const { members } of parseResults) {
      for (const member of members) {
        const existing = memberMap.get(member.platformId)
        if (existing) {
          if (member.accountName) {
            existing.accountName = member.accountName
          }
          if (member.groupNickname) {
            existing.groupNickname = member.groupNickname
          }
          // 头像使用最新的（覆盖更新）
          if (member.avatar) {
            existing.avatar = member.avatar
          }
        } else {
          memberMap.set(member.platformId, {
            platformId: member.platformId,
            accountName: member.accountName,
            groupNickname: member.groupNickname,
            avatar: member.avatar,
          })
        }
      }
    }

    // 流式合并消息（去重）- 使用 Set 替代 Map 以提高性能
    // 注：冲突解决方案通过消息处理顺序生效（第一个被处理的版本会被保留）
    const seenKeys = new Set<string>()
    const mergedMessages: ChatLabMessage[] = []
    let totalProcessed = 0
    const startTime = Date.now()

    for (const { reader, source } of parseResults) {
      const readerStartTime = Date.now()
      let readerCount = 0

      reader.streamMessages(10000, (messages) => {
        for (const msg of messages) {
          const key = getMessageKey(msg)

          // 跳过已处理的消息（去重）
          if (seenKeys.has(key)) {
            continue
          }
          seenKeys.add(key)

          // 注：冲突已在去重时处理（seenKeys），用户选择的冲突解决方案
          // 决定了哪个版本的消息先被处理，后续相同 key 的消息会被跳过

          mergedMessages.push({
            sender: msg.senderPlatformId,
            accountName: msg.senderAccountName,
            groupNickname: msg.senderGroupNickname,
            timestamp: msg.timestamp,
            type: msg.type,
            content: msg.content,
          })

          readerCount++
        }
        totalProcessed += messages.length
      })

      console.log(
        `[Merger] Processing ${source}: ${readerCount}  unique messages, elapsed: ${Date.now() - readerStartTime}ms`
      )
    }

    // 排序
    const sortStartTime = Date.now()
    mergedMessages.sort((a, b) => a.timestamp - b.timestamp)
    console.log(`[Merger] Sort elapsed: ${Date.now() - sortStartTime}ms`)

    console.log(`[Merger] Messages after merge: ${mergedMessages.length}`)

    // 确定平台（使用第一个文件的平台）
    const platform = parseResults[0].meta.platform

    // 确定群ID和群头像（仅当所有文件都来自同一个群时保留）
    const groupIds = new Set(parseResults.map((r) => r.meta.groupId).filter(Boolean))
    const groupId = groupIds.size === 1 ? parseResults.find((r) => r.meta.groupId)?.meta.groupId : undefined
    // 如果有唯一群ID，使用最后一个文件的群头像（可能是最新的）
    const groupAvatar = groupId
      ? parseResults.filter((r) => r.meta.groupId === groupId).pop()?.meta.groupAvatar
      : undefined

    // 构建来源信息
    const sources: MergeSource[] = parseResults.map(({ reader, source, meta }) => ({
      filename: source,
      platform: meta.platform,
      messageCount: reader.getMessageCount(),
    }))

    // 构建 ChatLab 格式数据
    const chatLabHeader = {
      version: '0.0.1',
      exportedAt: Math.floor(Date.now() / 1000),
      generator: 'ChatLab Merge Tool',
      description: `合并自 ${parseResults.length} 个文件`,
    }

    const chatLabMeta = {
      name: outputName,
      platform: platform as ChatPlatform,
      type: parseResults[0].meta.type as ChatType,
      sources,
      groupId,
      groupAvatar,
    }

    const chatLabMembers = Array.from(memberMap.values())

    // 写入文件
    const targetDir = outputDir || getDefaultOutputDir()
    ensureOutputDir(targetDir)
    const filename = generateOutputFilename(outputName, outputFormat)
    const outputPath = path.join(targetDir, filename)

    const writeStartTime = Date.now()

    if (outputFormat === 'jsonl') {
      // JSONL 格式：流式写入，每行一个 JSON 对象
      const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' })

      // 写入 header 行
      writeStream.write(
        JSON.stringify({
          _type: 'header',
          chatlab: chatLabHeader,
          meta: chatLabMeta,
        }) + '\n'
      )

      // 写入 member 行
      for (const member of chatLabMembers) {
        writeStream.write(
          JSON.stringify({
            _type: 'member',
            ...member,
          }) + '\n'
        )
      }

      // 写入 message 行
      for (const msg of mergedMessages) {
        writeStream.write(
          JSON.stringify({
            _type: 'message',
            ...msg,
          }) + '\n'
        )
      }

      writeStream.end()

      // 等待写入完成
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })

      console.log(`[Merger] Write JSONL elapsed: ${Date.now() - writeStartTime}ms`)
    } else {
      // JSON 格式：格式化输出
      const chatLabData: ChatLabFormat = {
        chatlab: chatLabHeader,
        meta: chatLabMeta,
        members: chatLabMembers,
        messages: mergedMessages,
      }
      fs.writeFileSync(outputPath, JSON.stringify(chatLabData, null, 2), 'utf-8')
      console.log(`[Merger] Write JSON elapsed: ${Date.now() - writeStartTime}ms`)
    }
    console.log(`[Merger] Total merge elapsed: ${Date.now() - startTime}ms`)

    // 如果需要分析，导入数据库
    let sessionId: string | undefined
    if (andAnalyze) {
      const importStartTime = Date.now()
      const parseResult: ParseResult = {
        meta: {
          name: chatLabMeta.name,
          platform: chatLabMeta.platform,
          type: chatLabMeta.type,
          groupId: chatLabMeta.groupId,
          groupAvatar: chatLabMeta.groupAvatar,
        },
        members: chatLabMembers.map((m) => ({
          platformId: m.platformId,
          accountName: m.accountName,
          groupNickname: m.groupNickname,
          avatar: m.avatar,
        })),
        messages: mergedMessages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderAccountName: msg.accountName,
          senderGroupNickname: msg.groupNickname,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        })),
      }
      sessionId = importData(parseResult)
      console.log(`[Merger] Database import elapsed: ${Date.now() - importStartTime}ms`)
    }

    return {
      success: true,
      outputPath,
      sessionId,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '合并失败',
    }
  } finally {
    // 关闭所有 reader
    for (const reader of readers) {
      reader.close()
    }
  }
}

// ==================== 从会话数据库导出 ====================

import Database from 'better-sqlite3'
import { getDbPath } from '../database/core'

/**
 * 从已导入的会话数据库导出为临时 JSON 文件
 * 用于批量管理中的合并功能
 */
export async function exportSessionToTempFile(sessionId: string): Promise<string> {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    throw new Error(`会话数据库不存在: ${sessionId}`)
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    // 读取 meta
    const meta = db.prepare('SELECT * FROM meta').get() as {
      name: string
      platform: string
      type: string
      group_id?: string
      group_avatar?: string
    }

    if (!meta) {
      throw new Error('无法读取会话元信息')
    }

    // 读取 members
    const members = db.prepare('SELECT platform_id, account_name, group_nickname, avatar FROM member').all() as Array<{
      platform_id: string
      account_name?: string
      group_nickname?: string
      avatar?: string
    }>

    // 读取 messages（通过 JOIN 获取发送者信息）
    const messages = db
      .prepare(
        `SELECT 
          m.platform_id as sender,
          msg.sender_account_name as accountName,
          msg.sender_group_nickname as groupNickname,
          msg.ts as timestamp,
          msg.type,
          msg.content
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ORDER BY msg.ts`
      )
      .all() as Array<{
      sender: string
      accountName?: string
      groupNickname?: string
      timestamp: number
      type: number
      content?: string
    }>

    // 构建 ChatLab 格式数据
    const chatLabData: ChatLabFormat = {
      chatlab: {
        version: '0.0.1',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab Export',
        description: `导出自会话: ${meta.name}`,
      },
      meta: {
        name: meta.name,
        platform: meta.platform as ChatPlatform,
        type: meta.type as ChatType,
        groupId: meta.group_id,
        groupAvatar: meta.group_avatar,
      },
      members: members.map((m) => ({
        platformId: m.platform_id,
        accountName: m.account_name || m.platform_id,
        groupNickname: m.group_nickname || undefined,
        avatar: m.avatar,
      })),
      messages: messages.map((msg) => ({
        sender: msg.sender,
        accountName: msg.accountName || msg.sender,
        groupNickname: msg.groupNickname || undefined,
        timestamp: msg.timestamp,
        type: msg.type as ChatLabMessage['type'],
        content: msg.content ?? null,
      })),
    }

    // 写入临时文件
    const tempDir = path.join(getDefaultOutputDir(), '.chatlab_temp')
    ensureOutputDir(tempDir)
    const tempFilePath = path.join(tempDir, `export_${sessionId}_${Date.now()}.json`)
    fs.writeFileSync(tempFilePath, JSON.stringify(chatLabData, null, 2), 'utf-8')

    console.log(`[Merger] Exporting session to temp file: ${tempFilePath}, message count: ${messages.length}`)

    return tempFilePath
  } finally {
    db.close()
  }
}

/**
 * 清理临时导出文件
 */
export function cleanupTempExportFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`[Merger] Cleaning up temp file: ${filePath}`)
      }
    } catch (err) {
      console.error(`[Merger] Failed to clean up temp file: ${filePath}`, err)
    }
  }
}
