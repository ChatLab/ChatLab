/**
 * Session management MCP tools
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listSessions } from '../db.js'
import { formatTimestamp } from '../utils/format.js'

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
}
