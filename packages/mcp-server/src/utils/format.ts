/**
 * Result formatting utilities for MCP Server
 */

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
