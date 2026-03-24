/**
 * SQL query and schema MCP tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { openDatabase } from '../db.js'
import * as queries from '../queries.js'

export function registerSqlTools(server: McpServer): void {
  server.tool(
    'execute_sql',
    'Execute a read-only SQL query against a chat database. Only SELECT statements are allowed. Use get_schema first to understand the table structure.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
      sql: z.string().describe('SQL SELECT query to execute'),
    },
    async ({ session_id, sql }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      try {
        const result = queries.executeRawSQL(db, sql)

        if (result.rowCount === 0) {
          return { content: [{ type: 'text', text: 'Query returned no results.' }] }
        }

        // Format as table
        const header = result.columns.join(' | ')
        const separator = result.columns.map(() => '---').join(' | ')
        const rows = result.rows.map((row) =>
          row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | ')
        )

        const text = [
          `${result.rowCount} rows (${result.duration}ms):`,
          '',
          header,
          separator,
          ...rows,
        ].join('\n')

        return { content: [{ type: 'text', text }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `SQL Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'get_schema',
    'Get the database schema (tables and columns) of a chat session. Useful before writing custom SQL queries.',
    {
      session_id: z.string().describe('The session ID (from list_sessions)'),
    },
    async ({ session_id }) => {
      const db = openDatabase(session_id)
      if (!db) {
        return { content: [{ type: 'text', text: `Session "${session_id}" not found.` }] }
      }

      const schema = queries.getSchema(db)

      const lines = schema.map((table) => {
        const cols = table.columns.map((col) => {
          const flags = [col.pk ? 'PK' : '', col.notnull ? 'NOT NULL' : ''].filter(Boolean).join(', ')
          return `    ${col.name} ${col.type}${flags ? ` (${flags})` : ''}`
        })
        return `${table.name}:\n${cols.join('\n')}`
      })

      return {
        content: [{ type: 'text', text: `Database schema:\n\n${lines.join('\n\n')}` }],
      }
    }
  )
}
