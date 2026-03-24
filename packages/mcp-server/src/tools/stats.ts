/**
 * Statistics and analytics MCP tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { openDatabase } from '../db.js'
import * as queries from '../queries.js'

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function registerStatsTools(server: McpServer): void {
  server.tool(
    'get_time_stats',
    'Get message activity statistics by time dimension: hourly (0-23h distribution), daily (day-by-day trend), weekday (Mon-Sun), or monthly (Jan-Dec).',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      type: z.enum(['hourly', 'daily', 'weekday', 'monthly']).describe('Type of time statistics'),
    },
    async ({ session_id, type }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      let text: string

      switch (type) {
        case 'hourly': {
          const data = queries.getHourlyActivity(db)
          const lines = data.map((d) => `${String(d.hour).padStart(2, '0')}:00 — ${d.messageCount} messages`)
          const peak = data.reduce((a, b) => (a.messageCount > b.messageCount ? a : b))
          text = `Hourly activity distribution:\n\n${lines.join('\n')}\n\nPeak hour: ${peak.hour}:00 (${peak.messageCount} messages)`
          break
        }
        case 'daily': {
          const data = queries.getDailyActivity(db)
          if (data.length === 0) {
            text = 'No daily activity data.'
            break
          }
          const total = data.reduce((sum, d) => sum + d.messageCount, 0)
          const avg = Math.round(total / data.length)
          const peak = data.reduce((a, b) => (a.messageCount > b.messageCount ? a : b))
          // Show summary + last 30 days
          const recent = data.slice(-30)
          const lines = recent.map((d) => `${d.date} — ${d.messageCount} messages`)
          text = [
            `Daily activity (${data.length} days total, showing last ${recent.length}):`,
            `Average: ${avg} messages/day | Peak: ${peak.date} (${peak.messageCount})`,
            '',
            ...lines,
          ].join('\n')
          break
        }
        case 'weekday': {
          const data = queries.getWeekdayActivity(db)
          const lines = data.map((d) => `${WEEKDAY_NAMES[d.weekday]} — ${d.messageCount} messages`)
          const peak = data.reduce((a, b) => (a.messageCount > b.messageCount ? a : b))
          text = `Weekday activity distribution:\n\n${lines.join('\n')}\n\nMost active: ${WEEKDAY_NAMES[peak.weekday]} (${peak.messageCount} messages)`
          break
        }
        case 'monthly': {
          const data = queries.getMonthlyActivity(db)
          const lines = data.map((d) => `${MONTH_NAMES[d.month]} — ${d.messageCount} messages`)
          const peak = data.reduce((a, b) => (a.messageCount > b.messageCount ? a : b))
          text = `Monthly activity distribution:\n\n${lines.join('\n')}\n\nMost active: ${MONTH_NAMES[peak.month]} (${peak.messageCount} messages)`
          break
        }
      }

      return { content: [{ type: 'text', text }] }
    }
  )
}
