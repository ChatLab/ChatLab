/**
 * Chat record merger module — Electron adapter layer.
 * Delegates pure algorithms to @openchatlab/core and orchestration to @openchatlab/node-runtime.
 * Keeps only platform-specific I/O: file parsing, temp DB access, session DB export, importData.
 */

import * as fs from 'fs'
import * as path from 'path'
import { checkConflictsFromSources, buildMergedOutput, serializeChatLabToJsonl } from '@openchatlab/node-runtime'
import type { ChatLabOutput } from '@openchatlab/node-runtime'
import { importData } from '../database/core'
import { TempDbReader } from './tempCache'
import { getPathProvider } from '../path-context'
import type { ChatPlatform, ChatType } from '../../../src/types/base'
import type {
  ChatLabFormat,
  ChatLabMessage,
  ConflictCheckResult,
  MergeParams,
  MergeResult,
} from '../../../src/types/format'

function getDefaultOutputDir(): string {
  return getPathProvider().getDownloadsDir()
}

function ensureOutputDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function generateOutputFilename(name: string, format: 'json' | 'jsonl' = 'json'): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeName = name.replace(/[/\\?%*:|"<>]/g, '_')
  return `${safeName}_merged_${date}.${format}`
}

// ==================== ChatLabOutput → ChatLabFormat conversion ====================

function chatLabOutputToFormat(data: ChatLabOutput): ChatLabFormat {
  return {
    chatlab: data.chatlab,
    meta: {
      ...data.meta,
      platform: data.meta.platform as ChatPlatform,
      type: data.meta.type as ChatType,
    },
    members: data.members.map((m) => ({
      platformId: m.platformId,
      accountName: m.accountName || m.platformId,
      groupNickname: m.groupNickname,
      avatar: m.avatar,
    })),
    messages: data.messages.map((msg) => ({
      sender: msg.sender,
      accountName: msg.accountName || msg.sender,
      groupNickname: msg.groupNickname,
      timestamp: msg.timestamp,
      type: msg.type,
      content: msg.content ?? null,
    })),
  }
}

// ==================== TempDB-based merge (delegates to node-runtime) ====================

export async function checkConflictsWithTempDb(
  filePaths: string[],
  tempDbCache: Map<string, string>
): Promise<ConflictCheckResult> {
  const readers: TempDbReader[] = []
  try {
    const dataSources: Array<{ source: ReturnType<TempDbReader['toDataSource']>; filename: string }> = []
    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`Temp database not found: ${path.basename(filePath)}`)
      }
      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)
      dataSources.push({ source: reader.toDataSource(), filename: path.basename(filePath) })
    }

    return checkConflictsFromSources(dataSources)
  } finally {
    for (const reader of readers) {
      reader.close()
    }
  }
}

export async function mergeFilesWithTempDb(
  params: MergeParams,
  tempDbCache: Map<string, string>
): Promise<MergeResult> {
  const { filePaths, outputName, outputDir, outputFormat = 'json', andAnalyze } = params

  console.log('[Merger] mergeFilesWithTempDb: Starting merge')

  const readers: TempDbReader[] = []
  try {
    const dataSources: Array<{ source: ReturnType<TempDbReader['toDataSource']>; filename: string }> = []
    for (const filePath of filePaths) {
      const tempDbPath = tempDbCache.get(filePath)
      if (!tempDbPath) {
        throw new Error(`Temp database not found: ${path.basename(filePath)}`)
      }
      const reader = new TempDbReader(tempDbPath)
      readers.push(reader)
      dataSources.push({ source: reader.toDataSource(), filename: path.basename(filePath) })
    }

    const result = buildMergedOutput(dataSources, outputName)
    const chatLabData = result.chatLabData

    const targetDir = outputDir || getDefaultOutputDir()
    ensureOutputDir(targetDir)
    const filename = generateOutputFilename(outputName, outputFormat)
    const outputPath = path.join(targetDir, filename)

    if (outputFormat === 'jsonl') {
      const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' })
      for (const line of serializeChatLabToJsonl(chatLabData)) {
        writeStream.write(line + '\n')
      }
      writeStream.end()
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })
    } else {
      const fileData: ChatLabFormat = chatLabOutputToFormat(chatLabData)
      fs.writeFileSync(outputPath, JSON.stringify(fileData, null, 2), 'utf-8')
    }

    console.log(`[Merger] Messages after merge: ${chatLabData.messages.length}`)

    let sessionId: string | undefined
    if (andAnalyze) {
      const fmt = chatLabOutputToFormat(chatLabData)
      sessionId = importData({
        meta: {
          name: fmt.meta.name,
          platform: fmt.meta.platform,
          type: fmt.meta.type,
          groupId: fmt.meta.groupId,
          groupAvatar: fmt.meta.groupAvatar,
        },
        members: fmt.members.map((m) => ({
          platformId: m.platformId,
          accountName: m.accountName,
          groupNickname: m.groupNickname,
          avatar: m.avatar,
        })),
        messages: fmt.messages.map((msg) => ({
          senderPlatformId: msg.sender,
          senderAccountName: msg.accountName,
          senderGroupNickname: msg.groupNickname,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        })),
      })
    }

    return { success: true, outputPath, sessionId }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Merge failed',
    }
  } finally {
    for (const reader of readers) {
      reader.close()
    }
  }
}

// ==================== Session DB export ====================

import Database from 'better-sqlite3'
import { getDbPath } from '../database/core'

export async function exportSessionToTempFile(sessionId: string): Promise<string> {
  const dbPath = getDbPath(sessionId)
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Session database not found: ${sessionId}`)
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    const meta = db.prepare('SELECT * FROM meta').get() as {
      name: string
      platform: string
      type: string
      group_id?: string
      group_avatar?: string
    }

    if (!meta) {
      throw new Error('Cannot read session meta')
    }

    const members = db.prepare('SELECT platform_id, account_name, group_nickname, avatar FROM member').all() as Array<{
      platform_id: string
      account_name?: string
      group_nickname?: string
      avatar?: string
    }>

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

    const chatLabData: ChatLabFormat = {
      chatlab: {
        version: '0.0.1',
        exportedAt: Math.floor(Date.now() / 1000),
        generator: 'ChatLab Export',
        description: `Exported from session: ${meta.name}`,
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
