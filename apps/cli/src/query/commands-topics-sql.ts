/**
 * topics / sql / schema query commands.
 *
 * Derived-text privacy (design §6.2): topic summaries are LLM-generated from raw
 * content and are desensitized by default. SQL string cells are desensitized,
 * but reading the message content column requires --raw so SQL expressions
 * cannot encode raw bodies before the sanitizer sees them.
 */

import type { Command } from 'commander'
import { getSegmentSummaries, getSegmentMessages, getDatabaseSchema, executeReadonlySql } from '@openchatlab/core'
import { desensitizeText, matchesBlacklist, type DesensitizeRule } from '@openchatlab/node-runtime'
import { runQuery } from './runner'
import { createQueryContext, assertRawAllowed, type QueryContext } from './context'
import { parseTimeOptions, parseLimit, epochToIso } from './parse'
import { QueryError } from './envelope'
import { buildMessagesResult, assertRawFormatCompatible } from './messages-output'

function enabledRules(ctx: QueryContext): DesensitizeRule[] {
  return ctx.preprocessConfig.desensitize ? ctx.preprocessConfig.desensitizeRules.filter((r) => r.enabled) : []
}

export function parseSqlRowLimit(value: string | undefined): number {
  return parseLimit(value, 100, 1000, '--limit', 1)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SQL_IDENTIFIER = String.raw`(?:"[^"]+"|'[^']+'|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)`
const SQL_TABLE_REF_END = String.raw`(?=\s|$|[,;])`
const SQL_KEYWORDS = new Set([
  'where',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'cross',
  'order',
  'group',
  'limit',
  'on',
  'using',
])

function sqlNamePattern(name: string): string {
  const escaped = escapeRegExp(name)
  return String.raw`(?:"${escaped}"|'${escaped}'|` + '`' + escaped + '`' + String.raw`|\[${escaped}\]|${escaped})`
}

function unquoteSqlIdentifier(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1)
  const quote = trimmed[0]
  if ((quote === '"' || quote === "'" || quote === '`') && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function messageTablePattern(): string {
  const schemaPrefix = String.raw`(?:${SQL_IDENTIFIER}\s*\.\s*)?`
  return `${schemaPrefix}${sqlNamePattern('message')}`
}

function selectsMessageStar(query: string): boolean {
  const selectMatch = query.match(/\bselect\b([\s\S]+?)\bfrom\b/i)
  if (!selectMatch) return false

  const projection = selectMatch[1]
  const messageTable = messageTablePattern()
  if (/(^|[,\s])\*(?=$|[,\s])/i.test(projection)) {
    return new RegExp(String.raw`\b(?:from|join)\s+${messageTable}${SQL_TABLE_REF_END}`, 'i').test(query)
  }

  const aliasMatches = query.matchAll(
    new RegExp(String.raw`\b(?:from|join)\s+${messageTable}(?:\s+(?:as\s+)?(${SQL_IDENTIFIER}))?`, 'gi')
  )
  const aliases = new Set(['message'])
  for (const match of aliasMatches) {
    const alias = match[1] ? unquoteSqlIdentifier(match[1]).toLowerCase() : undefined
    if (alias && !SQL_KEYWORDS.has(alias)) aliases.add(alias)
  }

  return [...aliases].some((alias) =>
    new RegExp(`${sqlNamePattern(alias)}\\s*\\.\\s*\\*(?=$|[\\s,])`, 'i').test(projection)
  )
}

export function assertSqlPrivacyAllowed(query: string, raw: boolean): void {
  if (raw) return
  if (!/(^|[^A-Za-z0-9_])["'`[]?content["'`\]]?(?![A-Za-z0-9_])/i.test(query) && !selectsMessageStar(query)) {
    return
  }

  throw new QueryError({
    code: 'INVALID_ARGUMENT',
    message: 'SQL queries that read message content require --raw',
    hint: 'Use dedicated message commands for privacy-processed content, or enable raw mode and pass --raw for debugging',
  })
}

export function assertSqlResultPrivacyAllowed(columns: readonly string[], raw: boolean): void {
  if (raw) return
  if (!columns.some((column) => unquoteSqlIdentifier(column).toLowerCase() === 'content')) return

  throw new QueryError({
    code: 'INVALID_ARGUMENT',
    message: 'SQL results that include message content require --raw',
    hint: 'Use dedicated message commands for privacy-processed content, or enable raw mode and pass --raw for debugging',
  })
}

export interface TopicListItem {
  id: number
  since: string
  until: string
  messages: number
  participants: string[]
  summary: string | null
}

/**
 * Agent-format body for topics list: compact text with [#segmentId] markers
 * that chain into `topics show --id <segmentId>`.
 */
export function topicsAgentText(items: TopicListItem[]): string {
  if (items.length === 0) return 'No summaries.'
  const blocks = items.map((t) => {
    const header = `[#${t.id}] ${t.since} ~ ${t.until} (${t.messages} msgs) ${t.participants.join(', ')}`
    return t.summary ? `${header}\n${t.summary}` : header
  })
  return `returned: ${items.length}\n\n${blocks.join('\n\n')}`
}

export function registerTopicCommands(program: Command): void {
  const topicsCmd = program.command('topics').description('Conversation segments and AI summaries')

  // ---------- topics list ----------
  topicsCmd
    .command('list')
    .description('List AI-generated segment summaries (desensitized)')
    .option('--session <ref>', 'Session id or unique name')
    .option('--since <t>', 'Start time')
    .option('--until <t>', 'End time')
    .option('--last <dur>', 'Relative window: <N>h|d|w')
    .option('--query <kw>', 'Filter summaries by substring')
    .option('--limit <n>', 'Max summaries (default 20, max 100)')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(
      async (options: {
        session?: string
        since?: string
        until?: string
        last?: string
        query?: string
        limit?: string
        format?: string
      }) => {
        await runQuery('topics.list', options, async (format) => {
          const ctx = createQueryContext(options)
          try {
            const time = parseTimeOptions(options)
            const limit = parseLimit(options.limit, 20, 100, '--limit')
            const timeFilter =
              time.startTs !== undefined || time.endTs !== undefined
                ? { startTs: time.startTs ?? 0, endTs: time.endTs ?? Math.floor(Date.now() / 1000) }
                : undefined

            // over-fetch so blacklist-dropped summaries don't shrink the page
            const rows = getSegmentSummaries(ctx.db, { limit: limit + 20, timeFilter })
            const rules = enabledRules(ctx)
            const blacklist = ctx.preprocessConfig.blacklistKeywords

            let removed = 0
            const items = rows
              .filter((row) => {
                if (row.summary && matchesBlacklist(row.summary, blacklist)) {
                  removed++
                  return false
                }
                return true
              })
              .map((row) => ({
                id: row.id,
                since: epochToIso(row.startTs),
                until: epochToIso(row.endTs),
                messages: row.messageCount,
                participants: row.participants,
                summary: row.summary ? desensitizeText(row.summary, rules) : row.summary,
              }))
              .filter((row) => (options.query ? (row.summary ?? '').includes(options.query) : true))
              .slice(0, limit)

            if (items.length === 0) {
              const any = getSegmentSummaries(ctx.db, { limit: 1 })
              if (any.length === 0) {
                const hint = 'Run summary generation in the ChatLab app, or use `chatlab stats keywords` as a fallback.'
                return {
                  data:
                    format === 'agent'
                      ? { text: 'No AI summaries generated yet.', status: 'summaries_not_generated' }
                      : { items: [], status: 'summaries_not_generated' },
                  meta: { session: ctx.session, hint },
                }
              }
            }

            const meta = {
              session: ctx.session,
              timeRange: time.meta,
              returned: items.length,
              ...(removed > 0 ? { warnings: [`${removed} summaries removed by blacklist`] } : {}),
            }
            return {
              data: format === 'agent' ? { text: topicsAgentText(items) } : { items },
              meta,
              renderText: () => topicsAgentText(items),
            }
          } finally {
            ctx.close()
          }
        })
      }
    )

  // ---------- topics show ----------
  topicsCmd
    .command('show')
    .description('Show original messages of one segment')
    .requiredOption('--id <segment-id>', 'Segment id from topics list')
    .option('--session <ref>', 'Session id or unique name')
    .option('--limit <n>', 'Max messages (default 200, max 500)')
    .option('--format <format>', 'Output format: agent|json|text')
    .option('--max-tokens <n>', 'Token budget for agent text (default 4000)')
    .option('--max-chars <n>', 'Per-message content char limit')
    .option('--full', 'Disable per-message content truncation')
    .option('--fields <a,b>', 'json format: only include these item fields')
    .option('--no-content', 'json format: omit message content')
    .option('--raw', 'Bypass privacy preprocessing (debugging; requires user opt-in, json/text only)')
    .option('--verbose', 'Include preprocessing diagnostics in meta')
    .action(
      async (options: {
        id: string
        session?: string
        limit?: string
        format?: string
        maxTokens?: string
        maxChars?: string
        full?: boolean
        fields?: string
        content?: boolean
        raw?: boolean
        verbose?: boolean
      }) => {
        await runQuery('topics.show', options, async (format) => {
          assertRawFormatCompatible(format, options)
          const segmentId = Number(options.id)
          if (!Number.isInteger(segmentId) || segmentId < 0) {
            throw new QueryError({
              code: 'INVALID_ARGUMENT',
              message: `Invalid --id value: ${options.id}`,
              hint: 'Segment ids come from `chatlab topics list`',
            })
          }
          const ctx = createQueryContext(options)
          try {
            assertRawAllowed(ctx, options)
            const limit = parseLimit(options.limit, 200, 500, '--limit')
            const segment = getSegmentMessages(ctx.db, segmentId, limit)
            if (!segment) {
              throw new QueryError({
                code: 'SEGMENT_NOT_FOUND',
                message: `Segment ${segmentId} not found`,
                hint: 'Run `chatlab topics list` to see available segments',
              })
            }
            const meta: Record<string, unknown> = {
              session: ctx.session,
              segment: {
                id: segment.segmentId,
                since: epochToIso(segment.startTs),
                until: epochToIso(segment.endTs),
                messageCount: segment.messageCount,
                participants: segment.participants,
              },
              returnedHits: segment.returnedCount,
            }
            return buildMessagesResult(format, ctx, options, segment.messages, meta, {
              strategy: 'keep_last',
            })
          } finally {
            ctx.close()
          }
        })
      }
    )
}

export function registerSqlCommands(program: Command): void {
  program
    .command('sql')
    .description('Read-only SQL fallback (string cells are desensitized; message content requires --raw)')
    .argument('<query>', 'SELECT / WITH statement')
    .option('--session <ref>', 'Session id or unique name')
    .option('--limit <n>', 'Max rows (default 100, max 1000)')
    .option('--format <format>', 'Output format: agent|json|text')
    .option('--raw', 'Return raw cell values (debugging; requires user opt-in)')
    .action(async (query: string, options: { session?: string; limit?: string; format?: string; raw?: boolean }) => {
      await runQuery('sql', options, async () => {
        const ctx = createQueryContext(options)
        try {
          if (!ctx.allowSql) {
            throw new QueryError({
              code: 'SQL_DISABLED',
              message: 'The sql command is disabled by configuration',
              hint: 'The user can re-enable it with `chatlab config set cli.allow_sql true`',
            })
          }
          assertRawAllowed(ctx, options)
          assertSqlPrivacyAllowed(query, !!options.raw)
          const limit = parseSqlRowLimit(options.limit)

          let result
          try {
            result = executeReadonlySql(ctx.db, query, limit)
          } catch (err) {
            throw new QueryError({
              code: 'SQL_ERROR',
              message: err instanceof Error ? err.message : String(err),
              hint: 'Run `chatlab schema` to inspect available tables and columns',
            })
          }
          assertSqlResultPrivacyAllowed(result.columns, !!options.raw)

          let rows = result.rows
          let removed = 0
          if (!options.raw) {
            const rules = enabledRules(ctx)
            const blacklist = ctx.preprocessConfig.blacklistKeywords
            const sanitized: Record<string, unknown>[] = []
            for (const row of rows) {
              let drop = false
              const clean: Record<string, unknown> = {}
              for (const [key, value] of Object.entries(row)) {
                if (typeof value === 'string') {
                  if (matchesBlacklist(value, blacklist)) {
                    drop = true
                    break
                  }
                  clean[key] = desensitizeText(value, rules)
                } else {
                  clean[key] = value
                }
              }
              if (drop) removed++
              else sanitized.push(clean)
            }
            rows = sanitized
          }

          return {
            data: { columns: result.columns, rows, rowCount: rows.length, truncated: result.truncated },
            meta: {
              session: ctx.session,
              ...(options.raw ? { preprocess: { raw: true } } : {}),
              ...(removed > 0 ? { warnings: [`${removed} row(s) removed by blacklist`] } : {}),
            },
            renderText: () =>
              rows.length === 0
                ? 'No results.'
                : rows.map((r) => JSON.stringify(r)).join('\n') +
                  `\n${rows.length} row(s)${result.truncated ? ' (truncated)' : ''}`,
          }
        } finally {
          ctx.close()
        }
      })
    })

  program
    .command('schema')
    .description('Show session database schema (for the sql command)')
    .option('--session <ref>', 'Session id or unique name')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(async (options: { session?: string; format?: string }) => {
      await runQuery('schema', options, async () => {
        const ctx = createQueryContext(options)
        try {
          const items = getDatabaseSchema(ctx.db)
          return {
            data: { items },
            meta: { session: ctx.session, returned: items.length },
            renderText: () => items.map((t) => t.sql).join('\n\n'),
          }
        } finally {
          ctx.close()
        }
      })
    })
}
