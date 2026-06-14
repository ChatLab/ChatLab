/**
 * ChatLab 格式读取器
 *
 * 支持 ChatLab JSON (.json) 和 ChatLab JSONL (.jsonl) 两种格式。
 * 不依赖 stream-json，使用原生 readline 和 JSON.parse 实现。
 */

import * as fs from 'fs'
import * as readline from 'readline'
import type { ParsedMessageMedia } from '@openchatlab/shared-types'

export interface ImportMeta {
  name: string
  platform: string
  type: string
  groupId?: string
  groupAvatar?: string
  ownerId?: string
}

export interface ImportMember {
  platformId: string
  accountName: string
  groupNickname?: string
  avatar?: string
  roles?: Array<{ id: string; name?: string }>
}

export interface ImportMessage {
  platformMessageId?: string
  senderPlatformId: string
  senderAccountName: string
  senderGroupNickname?: string
  timestamp: number
  type: number
  content: string | null
  replyToMessageId?: string
  media?: ParsedMessageMedia
}

export interface ParsedData {
  meta: ImportMeta
  members: ImportMember[]
  messages: ImportMessage[]
}

export type ProgressCallback = (processed: number, total: number) => void

/**
 * 检测文件是否为 ChatLab 格式
 */
export function detectFormat(filePath: string): 'chatlab-json' | 'chatlab-jsonl' | null {
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.jsonl')) {
    const head = fs.readFileSync(filePath, { encoding: 'utf-8', flag: 'r' }).slice(0, 1024)
    if (head.includes('"_type"') && head.includes('"chatlab"')) {
      return 'chatlab-jsonl'
    }
    return null
  }
  if (ext.endsWith('.json')) {
    const head = fs.readFileSync(filePath, { encoding: 'utf-8', flag: 'r' }).slice(0, 4096)
    if (/"chatlab"\s*:\s*\{/.test(head)) {
      return 'chatlab-json'
    }
    return null
  }
  return null
}

/**
 * 解析 ChatLab JSON 格式文件
 */
export async function parseChatLabJson(filePath: string, onProgress?: ProgressCallback): Promise<ParsedData> {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const data = JSON.parse(raw)

  if (!data.chatlab || typeof data.chatlab !== 'object') {
    throw new Error('Invalid ChatLab JSON: missing "chatlab" field')
  }

  const meta: ImportMeta = {
    name: data.meta?.name || '未知',
    platform: data.meta?.platform || 'unknown',
    type: data.meta?.type || 'group',
    groupId: data.meta?.groupId,
    groupAvatar: data.meta?.groupAvatar,
    ownerId: data.meta?.ownerId,
  }

  const members: ImportMember[] = (data.members || []).map((m: Record<string, unknown>) => ({
    platformId: String(m.platformId || ''),
    accountName: String(m.accountName || m.platformId || ''),
    groupNickname: m.groupNickname ? String(m.groupNickname) : undefined,
    avatar: m.avatar ? String(m.avatar) : undefined,
    roles: m.roles as ImportMember['roles'],
  }))

  const rawMessages = data.messages || []
  const totalMessages = rawMessages.length

  const messages: ImportMessage[] = rawMessages.map((msg: Record<string, unknown>, i: number) => {
    if (onProgress && i % 10000 === 0) {
      onProgress(i, totalMessages)
    }
    return {
      platformMessageId: msg.platformMessageId ? String(msg.platformMessageId) : undefined,
      senderPlatformId: String(msg.sender || ''),
      senderAccountName: String(msg.accountName || msg.sender || ''),
      senderGroupNickname: msg.groupNickname ? String(msg.groupNickname) : undefined,
      timestamp: Number(msg.timestamp),
      type: Number(msg.type ?? 0),
      content: msg.content != null ? String(msg.content) : null,
      replyToMessageId: msg.replyToMessageId ? String(msg.replyToMessageId) : undefined,
    }
  })

  if (onProgress) onProgress(totalMessages, totalMessages)

  if (members.length === 0) {
    collectMembersFromMessages(messages, members)
  }

  return { meta, members, messages }
}

/**
 * 解析 ChatLab JSONL 格式文件
 */
export async function parseChatLabJsonl(filePath: string, onProgress?: ProgressCallback): Promise<ParsedData> {
  const meta: ImportMeta = { name: '未知', platform: 'unknown', type: 'group' }
  const members: ImportMember[] = []
  const messages: ImportMessage[] = []

  const stat = fs.statSync(filePath)
  let bytesRead = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf-8') + 1

    const trimmed = line.trim()
    if (!trimmed) continue

    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }

    const type = obj._type as string

    if (type === 'header' || (!type && obj.chatlab)) {
      const m = obj.meta as Record<string, unknown> | undefined
      if (m) {
        meta.name = String(m.name || '未知')
        meta.platform = String(m.platform || 'unknown')
        meta.type = String(m.type || 'group')
        if (m.groupId) meta.groupId = String(m.groupId)
        if (m.groupAvatar) meta.groupAvatar = String(m.groupAvatar)
        if (m.ownerId) meta.ownerId = String(m.ownerId)
      }
    } else if (type === 'member') {
      members.push({
        platformId: String(obj.platformId || ''),
        accountName: String(obj.accountName || obj.platformId || ''),
        groupNickname: obj.groupNickname ? String(obj.groupNickname) : undefined,
        avatar: obj.avatar ? String(obj.avatar) : undefined,
        roles: obj.roles as ImportMember['roles'],
      })
    } else if (type === 'message') {
      messages.push({
        platformMessageId: obj.platformMessageId ? String(obj.platformMessageId) : undefined,
        senderPlatformId: String(obj.sender || obj.senderPlatformId || ''),
        senderAccountName: String(obj.accountName || obj.senderAccountName || obj.sender || ''),
        senderGroupNickname: obj.groupNickname
          ? String(obj.groupNickname)
          : obj.senderGroupNickname
            ? String(obj.senderGroupNickname)
            : undefined,
        timestamp: Number(obj.timestamp),
        type: Number(obj.type ?? 0),
        content: obj.content != null ? String(obj.content) : null,
        replyToMessageId: obj.replyToMessageId ? String(obj.replyToMessageId) : undefined,
      })

      if (onProgress && messages.length % 10000 === 0) {
        onProgress(bytesRead, stat.size)
      }
    }
  }

  if (onProgress) onProgress(stat.size, stat.size)

  if (members.length === 0) {
    collectMembersFromMessages(messages, members)
  }

  return { meta, members, messages }
}

function collectMembersFromMessages(messages: ImportMessage[], members: ImportMember[]): void {
  const seen = new Set<string>()
  for (const msg of messages) {
    if (!seen.has(msg.senderPlatformId)) {
      seen.add(msg.senderPlatformId)
      members.push({
        platformId: msg.senderPlatformId,
        accountName: msg.senderAccountName || msg.senderPlatformId,
        groupNickname: msg.senderGroupNickname,
      })
    }
  }
}

/**
 * 统一入口：自动检测格式并解析
 */
export async function parseFile(filePath: string, onProgress?: ProgressCallback): Promise<ParsedData> {
  const format = detectFormat(filePath)
  if (!format) {
    throw new Error(`Unsupported file format: ${filePath}. Only ChatLab JSON (.json) and JSONL (.jsonl) are supported.`)
  }

  if (format === 'chatlab-json') {
    return parseChatLabJson(filePath, onProgress)
  } else {
    return parseChatLabJsonl(filePath, onProgress)
  }
}
