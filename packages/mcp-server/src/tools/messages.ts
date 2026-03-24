/**
 * Message search and retrieval MCP tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { openDatabase } from '../db.js'
import * as queries from '../queries.js'
import { formatTimestamp } from '../utils/format.js'

function formatMessages(messages: queries.MessageResult[]): string {
  return messages
    .map((m) => {
      const time = formatTimestamp(m.timestamp)
      const content = m.content || '[non-text message]'
      return `[${time}] ${m.senderName}: ${content}`
    })
    .join('\n')
}

export function registerMessageTools(server: McpServer): void {
  server.tool(
    'search_messages',
    'Search chat messages by keywords. Returns matching messages with sender and timestamp. Keywords are matched with OR logic (any keyword matches).',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      keywords: z.array(z.string()).describe('Keywords to search for (OR logic)'),
      sender_id: z.number().optional().describe('Optional: filter by sender member ID'),
      limit: z.number().optional().default(30).describe('Max results to return (default: 30)'),
    },
    async ({ session_id, keywords, sender_id, limit }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const result = queries.searchMessages(db, keywords, { senderId: sender_id, limit })

      if (result.messages.length === 0) {
        return { content: [{ type: 'text', text: `No messages found matching: ${keywords.join(', ')}` }] }
      }

      const text = [
        `Found ${result.total} messages (showing ${result.messages.length}):`,
        '',
        formatMessages(result.messages),
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'get_recent_messages',
    'Get the most recent messages in a chat session. Returns text messages in chronological order.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      limit: z.number().optional().default(50).describe('Number of messages to return (default: 50)'),
    },
    async ({ session_id, limit }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const result = queries.getRecentMessages(db, { limit })

      if (result.messages.length === 0) {
        return { content: [{ type: 'text', text: 'No messages found.' }] }
      }

      const text = [
        `Recent messages (${result.messages.length} of ${result.total} total):`,
        '',
        formatMessages(result.messages),
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'get_message_context',
    'Get messages surrounding a specific message ID. Useful for understanding the context of a conversation.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      message_id: z.number().describe('The message ID to get context for'),
      context_size: z.number().optional().default(20).describe('Number of messages before and after (default: 20)'),
    },
    async ({ session_id, message_id, context_size }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const messages = queries.getMessageContext(db, message_id, context_size)

      if (messages.length === 0) {
        return { content: [{ type: 'text', text: `Message ${message_id} not found.` }] }
      }

      return {
        content: [{ type: 'text', text: `Context around message ${message_id} (${messages.length} messages):\n\n${formatMessages(messages)}` }],
      }
    }
  )

  server.tool(
    'get_conversation_between',
    'Get the conversation between two specific members. Shows messages sent by either member in chronological order.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      member_id_1: z.number().describe('First member ID (from get_members)'),
      member_id_2: z.number().describe('Second member ID (from get_members)'),
      limit: z.number().optional().default(50).describe('Max messages to return (default: 50)'),
    },
    async ({ session_id, member_id_1, member_id_2, limit }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const result = queries.getConversationBetween(db, member_id_1, member_id_2, { limit })

      if (result.messages.length === 0) {
        return { content: [{ type: 'text', text: 'No conversation found between these members.' }] }
      }

      const text = [
        `Conversation between ${result.member1Name} and ${result.member2Name} (${result.messages.length} of ${result.total} messages):`,
        '',
        formatMessages(result.messages),
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    }
  )
}
