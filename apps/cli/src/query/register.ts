/**
 * Registration entry for agent-facing query commands (design §7) and the
 * deprecated top-level aliases (`search` / `query`, hidden, one major version).
 */

import type { Command } from 'commander'
import { searchMessagesLike, executeReadonlySql } from '@openchatlab/core'
import { initRuntime } from '../runtime'
import { registerSessionCommands, registerMemberCommands } from './commands-sessions-members'
import { registerMessageCommands } from './commands-messages'
import { registerStatsCommands } from './commands-stats'
import { registerTopicCommands, registerSqlCommands } from './commands-topics-sql'

export function registerQueryCommands(program: Command): void {
  registerSessionCommands(program)
  registerMemberCommands(program)
  registerMessageCommands(program)
  registerStatsCommands(program)
  registerTopicCommands(program)
  registerSqlCommands(program)
  registerLegacyAliases(program)
}

// ==================== Hidden legacy aliases (output kept byte-compatible) ====================

function registerLegacyAliases(program: Command): void {
  program
    .command('search <session-id> <keyword>', { hidden: true })
    .description('Deprecated: use `chatlab messages search`')
    .option('--limit <n>', 'Max results to return', '20')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .action((sessionId: string, keyword: string, options: { limit: string; format: string }) => {
      console.error(
        '[Deprecated] `chatlab search` — use `chatlab messages search <keyword> --session <id>`; alias kept for one major version'
      )
      const { dbManager } = initRuntime()
      const db = dbManager.open(sessionId)
      if (!db) {
        console.error(`Session ${sessionId} not found`)
        process.exit(1)
      }

      const limit = parseInt(options.limit)
      const result = searchMessagesLike(db, keyword, { limit })

      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(
          `Search "${keyword}" - ${result.total} result(s)${result.hasMore ? ' (showing first ' + limit + ')' : ''}:\n`
        )
        for (const msg of result.messages) {
          const time = new Date(msg.timestamp * 1000).toLocaleString()
          console.log(`  [${time}] ${msg.senderName}: ${msg.content}`)
        }
      }

      dbManager.closeAll()
    })

  program
    .command('query <session-id>', { hidden: true })
    .description('Deprecated: use `chatlab sql`')
    .requiredOption('--sql <sql>', 'SQL query statement')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .action((sessionId: string, options: { sql: string; format: string }) => {
      console.error(
        '[Deprecated] `chatlab query` — use `chatlab sql "<SELECT ...>" --session <id>`; alias kept for one major version'
      )
      const { dbManager } = initRuntime()
      const db = dbManager.open(sessionId)
      if (!db) {
        console.error(`Session ${sessionId} not found`)
        process.exit(1)
      }

      try {
        const result = executeReadonlySql(db, options.sql)
        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2))
        } else {
          if (result.rows.length === 0) {
            console.log('No results.')
          } else {
            printTable(result.columns, result.rows)
            console.log(`\n${result.rowCount} row(s)${result.truncated ? ' (truncated)' : ''}`)
          }
        }
      } catch (err) {
        console.error(`SQL error: ${err instanceof Error ? err.message : err}`)
        process.exit(1)
      }

      dbManager.closeAll()
    })
}

function printTable(columns: string[], rows: Record<string, unknown>[]): void {
  const widths = columns.map((col) => {
    const maxData = rows.reduce((max, row) => {
      const val = String(row[col] ?? '')
      return Math.max(max, val.length)
    }, 0)
    return Math.max(col.length, Math.min(maxData, 40))
  })

  const header = columns.map((col, i) => col.padEnd(widths[i])).join(' | ')
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-')
  console.log(header)
  console.log(separator)

  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col] ?? '')
        return val.length > 40 ? val.slice(0, 37) + '...' : val.padEnd(widths[i])
      })
      .join(' | ')
    console.log(line)
  }
}
