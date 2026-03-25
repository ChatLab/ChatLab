/**
 * Result formatting utilities for MCP Server
 */

import type { MessageResult } from '../queries.js'

/**
 * Format a unix timestamp to a human-readable date string
 */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

/**
 * Format a date range for display
 */
export function formatDateRange(start: number, end: number): string {
  return `${formatTimestamp(start)} ~ ${formatTimestamp(end)}`
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * Format messages as plain text
 */
export function formatMessagesAsText(messages: MessageResult[]): string {
  return messages
    .map((m) => {
      const time = formatTimestamp(m.timestamp)
      const content = m.content || '[non-text message]'
      return `[${time}] ${m.senderName}: ${content}`
    })
    .join('\n')
}

/**
 * Format messages as Markdown
 */
export function formatMessagesAsMarkdown(messages: MessageResult[]): string {
  return messages
    .map((m) => {
      const time = formatTimestamp(m.timestamp)
      const content = m.content || '*[non-text message]*'
      return `**${m.senderName}** (${time})\n> ${content}`
    })
    .join('\n\n')
}
