/**
 * Multi-format export: txt / json / markdown.
 * Simplified for time-range-only filtering (no keyword/context block logic).
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import { CHATLAB_FORMAT_VERSION } from '@openchatlab/shared-types'
import { appLogger } from '../logging/app-logger'

export type ExportFormat = 'txt' | 'json' | 'markdown'

export interface FormatExportParams {
  sessionId: string
  sessionName: string
  format: ExportFormat
  timeFilter?: { startTs: number; endTs: number }
}

export interface FormatExportResult {
  success: boolean
  error?: string
  totalMessages: number
  content: string
  filename: string
  mimeType: string
}

interface MessageRow {
  ts: number
  senderName: string
  sender: string
  accountName: string
  groupNickname: string | null
  type: number
  content: string | null
  platformMessageId: string | null
  replyToMessageId: string | null
}

interface MetaRow {
  name: string
  platform: string
  type: string
  groupId: string | null
  groupAvatar: string | null
  ownerId: string | null
}

interface MemberRow {
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string | null
  avatar: string | null
  roles: string | null
}

function queryMessages(db: DatabaseAdapter, timeFilter?: { startTs: number; endTs: number }): MessageRow[] {
  const hasFilter = !!timeFilter
  const sql = `
    SELECT msg.ts,
           COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
           m.platform_id as sender,
           COALESCE(msg.sender_account_name, m.account_name, m.platform_id) as accountName,
           COALESCE(msg.sender_group_nickname, m.group_nickname) as groupNickname,
           msg.type,
           msg.content,
           msg.platform_message_id as platformMessageId,
           msg.reply_to_message_id as replyToMessageId
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    ${hasFilter ? 'WHERE msg.ts >= ? AND msg.ts <= ?' : ''}
    ORDER BY msg.ts ASC, msg.id ASC
  `
  const params: unknown[] = []
  if (hasFilter) {
    params.push(timeFilter!.startTs, timeFilter!.endTs)
  }
  return db.prepare(sql).all(...params) as unknown as MessageRow[]
}

function formatTimeShort(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function exportAsTxt(messages: MessageRow[], sessionName: string): string {
  const lines: string[] = [`${sessionName}\n`]
  let lastDate = ''
  for (const msg of messages) {
    const date = new Date(msg.ts * 1000).toLocaleDateString()
    if (date !== lastDate) {
      lines.push(`\n--- ${date} ---\n`)
      lastDate = date
    }
    lines.push(`${formatTimeShort(msg.ts)} ${msg.senderName}: ${msg.content || '[non-text]'}`)
  }
  return lines.join('\n')
}

function parseOptionalArray<T>(value: string | null): T[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as T[]) : undefined
  } catch {
    return undefined
  }
}

function exportAsJson(
  db: DatabaseAdapter,
  messages: MessageRow[],
  sessionName: string,
  sourceSessionId: string
): string {
  const meta = db
    .prepare(
      `SELECT name,
              platform,
              type,
              group_id as groupId,
              group_avatar as groupAvatar,
              owner_id as ownerId
       FROM meta
       LIMIT 1`
    )
    .get() as unknown as MetaRow | undefined
  if (!meta) throw new Error('Cannot read session metadata')

  const members = db
    .prepare(
      `SELECT platform_id as platformId,
              account_name as accountName,
              group_nickname as groupNickname,
              aliases,
              avatar,
              roles
       FROM member
       ORDER BY id ASC`
    )
    .all() as unknown as MemberRow[]

  const data = {
    chatlab: {
      version: CHATLAB_FORMAT_VERSION,
      exportedAt: Math.floor(Date.now() / 1000),
      generator: 'ChatLab',
    },
    meta: {
      name: meta.name || sessionName,
      platform: meta.platform,
      type: meta.type,
      groupId: meta.groupId || undefined,
      groupAvatar: meta.groupAvatar || undefined,
      ownerId: meta.ownerId || undefined,
      sourceSessionId,
    },
    members: members.map((member) => ({
      platformId: member.platformId,
      accountName: member.accountName || member.platformId,
      groupNickname: member.groupNickname || undefined,
      aliases: parseOptionalArray<string>(member.aliases),
      avatar: member.avatar || undefined,
      roles: parseOptionalArray<{ id: string; name?: string }>(member.roles),
    })),
    messages: messages.map((msg) => ({
      sender: msg.sender,
      accountName: msg.accountName,
      groupNickname: msg.groupNickname || undefined,
      timestamp: msg.ts,
      type: msg.type,
      content: msg.content,
      platformMessageId: msg.platformMessageId || undefined,
      replyToMessageId: msg.replyToMessageId || undefined,
    })),
  }
  return JSON.stringify(data, null, 2)
}

function exportAsMarkdown(messages: MessageRow[], sessionName: string): string {
  const lines: string[] = [`# ${sessionName}\n`, `> Export time: ${new Date().toLocaleString()}\n`]
  let lastDate = ''
  for (const msg of messages) {
    const date = new Date(msg.ts * 1000).toLocaleDateString()
    if (date !== lastDate) {
      lines.push(`\n## ${date}\n`)
      lastDate = date
    }
    lines.push(`**${formatTimeShort(msg.ts)} ${msg.senderName}**: ${msg.content || '*[non-text]*'}`)
  }
  return lines.join('\n')
}

const FORMAT_CONFIG: Record<ExportFormat, { ext: string; mime: string }> = {
  txt: { ext: 'txt', mime: 'text/plain; charset=utf-8' },
  json: { ext: 'json', mime: 'application/json; charset=utf-8' },
  markdown: { ext: 'md', mime: 'text/markdown; charset=utf-8' },
}

export function exportWithFormat(
  params: FormatExportParams,
  openDatabase: (sessionId: string) => DatabaseAdapter | null
): FormatExportResult {
  const db = openDatabase(params.sessionId)
  if (!db) {
    return { success: false, error: 'Cannot open database', totalMessages: 0, content: '', filename: '', mimeType: '' }
  }

  try {
    const messages = queryMessages(db, params.timeFilter)
    if (messages.length === 0) {
      return {
        success: false,
        error: 'No messages found in the specified range',
        totalMessages: 0,
        content: '',
        filename: '',
        mimeType: '',
      }
    }

    const { ext, mime } = FORMAT_CONFIG[params.format]
    let content: string
    switch (params.format) {
      case 'txt':
        content = exportAsTxt(messages, params.sessionName)
        break
      case 'json':
        content = exportAsJson(db, messages, params.sessionName, params.sessionId)
        break
      case 'markdown':
        content = exportAsMarkdown(messages, params.sessionName)
        break
    }

    const timestamp = Date.now()
    const filename = `${params.sessionName}_export_${timestamp}.${ext}`
    appLogger.info('export', 'chat export generated', {
      sessionId: params.sessionId,
      format: params.format,
      totalMessages: messages.length,
      filteredByTime: !!params.timeFilter,
    })
    return { success: true, totalMessages: messages.length, content, filename, mimeType: mime }
  } catch (error) {
    appLogger.error('export', 'chat export failed', error)
    return {
      success: false,
      error: String(error),
      totalMessages: 0,
      content: '',
      filename: '',
      mimeType: '',
    }
  }
}
