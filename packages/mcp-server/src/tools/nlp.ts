/**
 * NLP analysis MCP tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { openDatabase } from '../db.js'
import * as queries from '../queries.js'

export function registerNlpTools(server: McpServer): void {
  server.tool(
    'get_word_frequency',
    'Get word frequency analysis for a chat session. Shows the most commonly used words or phrases. For CJK languages, extracts 2-3 character n-grams; for others, splits by whitespace.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      top_n: z.number().optional().default(50).describe('Number of top words to return (default: 50)'),
      min_count: z.number().optional().default(3).describe('Minimum occurrence count to include (default: 3)'),
    },
    async ({ session_id, top_n, min_count }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const result = queries.getWordFrequency(db, { topN: top_n, minCount: min_count })

      if (result.words.length === 0) {
        return { content: [{ type: 'text', text: 'No words found meeting the criteria.' }] }
      }

      const lines = result.words.map((w, i) => `${i + 1}. ${w.word} (${w.count})`)
      const text = [
        `Word frequency analysis (top ${result.words.length} of ${result.uniqueWords} unique, ${result.totalWords} total):`,
        '',
        ...lines,
      ].join('\n')

      return { content: [{ type: 'text', text }] }
    }
  )
}
