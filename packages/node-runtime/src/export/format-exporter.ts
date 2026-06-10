/**
 * Multi-format export: txt / json / markdown.
 * Simplified for time-range-only filtering (no keyword/context block logic).
 */

import type { DatabaseAdapter } from '@openchatlab/core'

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
  content: string | null
}

function queryMessages(db: DatabaseAdapter, timeFilter?: { startTs: number; endTs: number }): MessageRow[] {
  const hasFilter = !!timeFilter
  const sql = `
    SELECT msg.ts,
           COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
           msg.content
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

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
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

function exportAsJson(messages: MessageRow[], sessionName: string): string {
  const data = {
    sessionName,
    exportTime: new Date().toISOString(),
    totalMessages: messages.length,
    messages: messages.map((msg) => ({
      timestamp: msg.ts,
      time: formatTime(msg.ts),
      sender: msg.senderName,
      content: msg.content || '',
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
        content = exportAsJson(messages, params.sessionName)
        break
      case 'markdown':
        content = exportAsMarkdown(messages, params.sessionName)
        break
    }

    const filename = `${params.sessionName}_export.${ext}`
    return { success: true, totalMessages: messages.length, content, filename, mimeType: mime }
  } catch (error) {
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
