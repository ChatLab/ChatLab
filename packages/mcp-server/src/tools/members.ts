/**
 * Member query MCP tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { openDatabase } from '../db.js'
import * as queries from '../queries.js'

export function registerMemberTools(server: McpServer): void {
  server.tool(
    'get_members',
    'Get all members in a chat session with their message counts. Useful for finding member IDs needed by other tools.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
    },
    async ({ session_id }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const members = queries.getMembers(db)

      if (members.length === 0) {
        return { content: [{ type: 'text', text: 'No members found.' }] }
      }

      const lines = members.map((m) => {
        const name = m.groupNickname || m.accountName || m.platformId
        const aliasStr = m.aliases.length > 0 ? ` (aliases: ${m.aliases.join(', ')})` : ''
        return `ID: ${m.id} | ${name}${aliasStr} | ${m.messageCount} messages`
      })

      return {
        content: [{ type: 'text', text: `${members.length} members:\n\n${lines.join('\n')}` }],
      }
    }
  )

  server.tool(
    'get_member_stats',
    'Get member activity ranking - who sends the most messages. Shows top N members with message counts and percentages.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      top_n: z.number().optional().default(10).describe('Number of top members to return (default: 10)'),
    },
    async ({ session_id, top_n }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const result = queries.getMemberActivity(db)
      const topMembers = result.slice(0, top_n)

      if (topMembers.length === 0) {
        return { content: [{ type: 'text', text: 'No activity data found.' }] }
      }

      const lines = topMembers.map(
        (m, i) => `${i + 1}. ${m.name} — ${m.messageCount} messages (${m.percentage}%)`
      )

      return {
        content: [{
          type: 'text',
          text: `Top ${topMembers.length} members (out of ${result.length} total):\n\n${lines.join('\n')}`,
        }],
      }
    }
  )

  server.tool(
    'get_member_name_history',
    'Get the historical nicknames/names of a specific member. Useful for tracking identity changes over time.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      member_id: z.number().describe('The member ID (from get_members)'),
    },
    async ({ session_id, member_id }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const history = queries.getMemberNameHistory(db, member_id)

      if (history.length === 0) {
        return { content: [{ type: 'text', text: 'No name history found for this member.' }] }
      }

      const lines = history.map((h) => {
        const start = new Date(h.startTs * 1000).toISOString().split('T')[0]
        const end = h.endTs ? new Date(h.endTs * 1000).toISOString().split('T')[0] : 'present'
        return `${h.nameType}: "${h.name}" (${start} ~ ${end})`
      })

      return {
        content: [{ type: 'text', text: `Name history (${history.length} entries):\n\n${lines.join('\n')}` }],
      }
    }
  )
}
