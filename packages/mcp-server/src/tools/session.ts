/**
 * Session management MCP tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listSessions, openDatabase } from '../db.js'
import { formatTimestamp } from '../utils/format.js'
import * as queries from '../queries.js'

export function registerSessionTools(server: McpServer): void {
  server.tool(
    'list_sessions',
    'List all available chat sessions (imported chat histories). Returns session IDs, names, platforms, and basic statistics.',
    {},
    async () => {
      const sessions = listSessions()

      if (sessions.length === 0) {
        return {
          content: [{ type: 'text', text: 'No chat sessions found. Make sure the database directory is correct and contains .db files.' }],
        }
      }

      const lines = sessions.map((s) => {
        const timeInfo = s.timeRange
          ? `${formatTimestamp(s.timeRange.start)} ~ ${formatTimestamp(s.timeRange.end)}`
          : 'N/A'
        return [
          `Session ID: ${s.sessionId}`,
          `  Name: ${s.name}`,
          `  Platform: ${s.platform}`,
          `  Type: ${s.type}`,
          `  Messages: ${s.messageCount}`,
          `  Members: ${s.memberCount}`,
          `  Time Range: ${timeInfo}`,
        ].join('\n')
      })

      return {
        content: [{ type: 'text', text: `Found ${sessions.length} session(s):\n\n${lines.join('\n\n')}` }],
      }
    }
  )

  server.tool(
    'get_session_overview',
    'Get a comprehensive overview of a chat session including total messages, member count, time range, message type distribution, and top active members.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
    },
    async ({ session_id }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const overview = queries.getSessionOverview(db)

      const timeInfo = overview.timeRange
        ? `${formatTimestamp(overview.timeRange.start)} ~ ${formatTimestamp(overview.timeRange.end)}`
        : 'N/A'

      const typeLines = overview.messageTypes.map(
        (t) => `  ${t.typeName}: ${t.count}`
      )

      const memberLines = overview.topMembers.map(
        (m, i) => `  ${i + 1}. ${m.name} — ${m.messageCount} messages (${m.percentage}%)`
      )

      const text = [
        `Session Overview:`,
        `  Total Messages: ${overview.totalMessages}`,
        `  Total Members: ${overview.totalMembers}`,
        `  Time Range: ${timeInfo}`,
        '',
        'Message Types:',
        ...typeLines,
        '',
        'Top Members:',
        ...memberLines,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    }
  )
}
