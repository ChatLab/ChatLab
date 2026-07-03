/**
 * messages query command group: list / search / context / between.
 *
 * Counting and pagination operate on the privacy-filtered visible hit sequence:
 * user blacklist keywords are pushed down to SQL (design §5.4), so totalHits,
 * cursors and pages never expose blacklisted rows.
 */

import type { Command } from 'commander'
import {
  searchMessagesByKeywords,
  getMessageContext,
  getSearchMessageContext,
  getConversationBetween,
} from '@openchatlab/core'
import { runQuery } from './runner'
import { createQueryContext, assertRawAllowed } from './context'
import { resolveMember } from './resolve'
import { parseTimeOptions, parseLimit, queryFingerprint, encodeCursor, decodeCursor } from './parse'
import { QueryError } from './envelope'
import { buildMessagesResult, assertRawFormatCompatible, type MessageLike } from './messages-output'

interface CommonMessageOptions {
  session?: string
  since?: string
  until?: string
  last?: string
  limit?: string
  cursor?: string
  format?: string
  maxTokens?: string
  maxChars?: string
  full?: boolean
  fields?: string
  content?: boolean
  raw?: boolean
  verbose?: boolean
}

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option('--session <ref>', 'Session id or unique name (auto-selected when only one exists)')
    .option('--since <t>', 'Start time: YYYY-MM-DD, "YYYY-MM-DD HH:mm", ISO 8601, today, yesterday')
    .option('--until <t>', 'End time (date-only values include the whole day)')
    .option('--last <dur>', 'Relative window: <N>h|d|w (mutually exclusive with --since/--until)')
    .option('--format <format>', 'Output format: agent|json|text (agents should pass agent explicitly)')
    .option('--max-tokens <n>', 'Token budget for agent text (default 4000)')
    .option('--max-chars <n>', 'Per-message content char limit')
    .option('--full', 'Disable per-message content truncation')
    .option('--fields <a,b>', 'json format: only include these item fields')
    .option('--no-content', 'json format: omit message content (distribution scouting)')
    .option('--raw', 'Bypass privacy preprocessing (debugging; requires user opt-in, json/text only)')
    .option('--verbose', 'Include preprocessing diagnostics in meta')
}

export function registerMessageCommands(program: Command): void {
  const messagesCmd = program.command('messages').description('Query messages (list, search, context, between)')

  // ---------- messages list ----------
  const listCmd = messagesCmd
    .command('list')
    .description('List messages in a time window (most recent page first, rendered chronologically)')
    .option('--member <ref>', 'Filter by sender (member id, exact name, or `me`)')
    .option('--cursor <token>', 'Opaque pagination cursor from meta.nextCursor')
    .option('--limit <n>', 'Messages per page (default 50, max 500)')
  addSharedOptions(listCmd)
  listCmd.action(async (options: CommonMessageOptions & { member?: string }) => {
    await runQuery('messages.list', options, async (format) => {
      assertRawFormatCompatible(format, options)
      const ctx = createQueryContext(options)
      try {
        assertRawAllowed(ctx, options)
        const time = parseTimeOptions(options)
        const member = options.member ? resolveMember(ctx.db, options.member) : undefined
        const limit = parseLimit(options.limit, 50, 500, '--limit')
        const excludeKeywords = options.raw ? undefined : ctx.preprocessConfig.blacklistKeywords

        const fingerprint = queryFingerprint({
          command: 'messages.list',
          session: ctx.session.id,
          startTs: time.startTs ?? null,
          endTs: time.endTs ?? null,
          member: member?.id ?? null,
          exclude: excludeKeywords ?? [],
        })
        const offset = options.cursor ? decodeCursor(options.cursor, fingerprint) : 0

        const result = searchMessagesByKeywords(ctx.db, [], {
          startTs: time.startTs,
          endTs: time.endTs,
          senderId: member?.id,
          limit,
          offset,
          excludeKeywords,
          sort: 'desc',
        })

        const total = result.total ?? result.messages.length
        const hasMore = offset + result.messages.length < total
        const meta: Record<string, unknown> = {
          session: ctx.session,
          timeRange: time.meta,
          ...(member ? { member } : {}),
          totalHits: total,
          returnedHits: result.messages.length,
          hasMore,
          ...(hasMore ? { nextCursor: encodeCursor(offset + result.messages.length, fingerprint) } : {}),
        }

        return buildMessagesResult(format, ctx, options, result.messages, meta, {
          strategy: 'keep_last',
        })
      } finally {
        ctx.close()
      }
    })
  })

  // ---------- messages search ----------
  const searchCmd = messagesCmd
    .command('search')
    .description('Search messages by keywords (LIKE match; multiple keywords default to OR)')
    .argument('<keywords...>', 'Search keywords')
    .option('--match <mode>', 'Keyword join mode: any (OR) | all (AND)', 'any')
    .option('--member <ref>', 'Filter by sender (member id, exact name, or `me`)')
    .option('--context <n>', 'Context messages before/after each hit (default 0)')
    .option('--sort <dir>', 'Hit order by time: asc|desc (asc for "who said it first")', 'desc')
    .option('--cursor <token>', 'Opaque pagination cursor from meta.nextCursor')
    .option('--limit <n>', 'Hits per page (default 20, max 500)')
    .option('--max-messages <n>', 'Cap on total messages after context expansion (default 200)')
  addSharedOptions(searchCmd)
  searchCmd.action(
    async (
      keywords: string[],
      options: CommonMessageOptions & {
        match?: string
        member?: string
        context?: string
        sort?: string
        maxMessages?: string
      }
    ) => {
      await runQuery('messages.search', options, async (format) => {
        assertRawFormatCompatible(format, options)
        if (options.match !== 'any' && options.match !== 'all') {
          throw new QueryError({
            code: 'INVALID_ARGUMENT',
            message: `Invalid --match value: ${options.match}`,
            hint: 'Supported: any (OR), all (AND)',
          })
        }
        if (options.sort !== 'asc' && options.sort !== 'desc') {
          throw new QueryError({
            code: 'INVALID_ARGUMENT',
            message: `Invalid --sort value: ${options.sort}`,
            hint: 'Supported: asc, desc',
          })
        }
        const ctx = createQueryContext(options)
        try {
          assertRawAllowed(ctx, options)
          const time = parseTimeOptions(options)
          const member = options.member ? resolveMember(ctx.db, options.member) : undefined
          const limit = parseLimit(options.limit, 20, 500, '--limit')
          const context = parseLimit(options.context, 0, 50, '--context')
          const maxMessages = parseLimit(options.maxMessages, 200, 2000, '--max-messages')
          const excludeKeywords = options.raw ? undefined : ctx.preprocessConfig.blacklistKeywords

          const fingerprint = queryFingerprint({
            command: 'messages.search',
            session: ctx.session.id,
            keywords,
            match: options.match,
            sort: options.sort,
            startTs: time.startTs ?? null,
            endTs: time.endTs ?? null,
            member: member?.id ?? null,
            exclude: excludeKeywords ?? [],
          })
          const offset = options.cursor ? decodeCursor(options.cursor, fingerprint) : 0

          const result = searchMessagesByKeywords(ctx.db, keywords, {
            startTs: time.startTs,
            endTs: time.endTs,
            senderId: member?.id,
            limit,
            offset,
            matchMode: options.match,
            excludeKeywords,
            sort: options.sort as 'asc' | 'desc',
          })

          const hits = result.messages
          const hitIds = new Set(hits.map((m) => m.id))
          const warnings: string[] = []

          let pipelineMessages: MessageLike[] = hits
          if (context > 0 && hits.length > 0) {
            const perHitCost = context * 2 + 1
            let expandableHits = hits
            if (hits.length * perHitCost > maxMessages) {
              const allowed = Math.max(1, Math.floor(maxMessages / perHitCost))
              expandableHits = hits.slice(0, allowed)
              warnings.push(
                `--max-messages ${maxMessages}: context expanded for the first ${allowed} of ${hits.length} hits`
              )
            }
            const expanded = getSearchMessageContext(
              ctx.db,
              expandableHits.map((m) => m.id),
              context,
              context
            )
            const keptHits = new Set(expandableHits.map((m) => m.id))
            const tail = hits.filter((m) => !keptHits.has(m.id))
            pipelineMessages = [...expanded, ...tail]
            if (pipelineMessages.length > maxMessages) {
              pipelineMessages = pipelineMessages.slice(0, maxMessages)
              warnings.push(`response capped at ${maxMessages} messages`)
            }
          }

          const total = result.total ?? hits.length
          const hasMore = offset + hits.length < total
          const meta: Record<string, unknown> = {
            session: ctx.session,
            timeRange: time.meta,
            query: { keywords, match: options.match, engine: 'like', sort: options.sort, context },
            ...(member ? { member } : {}),
            totalHits: total,
            returnedHits: hits.length,
            hasMore,
            ...(hasMore ? { nextCursor: encodeCursor(offset + hits.length, fingerprint) } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
          }

          return buildMessagesResult(format, ctx, options, pipelineMessages, meta, {
            hitIds,
            strategy: 'keep_first',
            defaultMaxChars: 120,
          })
        } finally {
          ctx.close()
        }
      })
    }
  )

  // ---------- messages context ----------
  const contextCmd = messagesCmd
    .command('context')
    .description('Show messages around specific message ids (evidence follow-up)')
    .requiredOption('--id <ids>', 'Message id(s), comma-separated')
    .option('--window <n>', 'Messages before/after each id (default 10, max 100)')
  addSharedOptions(contextCmd)
  contextCmd.action(async (options: CommonMessageOptions & { id: string; window?: string }) => {
    await runQuery('messages.context', options, async (format) => {
      assertRawFormatCompatible(format, options)
      const ids = options.id.split(',').map((s) => Number(s.trim()))
      if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n < 0)) {
        throw new QueryError({
          code: 'INVALID_ARGUMENT',
          message: `Invalid --id value: ${options.id}`,
          hint: 'Pass numeric message ids, e.g. --id 1021 or --id 1021,1058',
        })
      }
      const ctx = createQueryContext(options)
      try {
        assertRawAllowed(ctx, options)
        const window = parseLimit(options.window, 10, 100, '--window')
        const messages = getMessageContext(ctx.db, ids, window)
        if (messages.length === 0) {
          throw new QueryError({
            code: 'MESSAGE_NOT_FOUND',
            message: `No messages found for id(s) ${options.id}`,
            hint: 'Message ids come from [#id] markers in search results',
          })
        }
        const meta: Record<string, unknown> = {
          session: ctx.session,
          anchorIds: ids,
          window,
        }
        return buildMessagesResult(format, ctx, options, messages, meta, {
          hitIds: new Set(ids),
          strategy: 'keep_last',
        })
      } finally {
        ctx.close()
      }
    })
  })

  // ---------- messages between ----------
  const betweenCmd = messagesCmd
    .command('between')
    .description('Conversation between two members (repeat --member exactly twice)')
    .option('--member <ref>', 'Member id, exact name, or `me` (repeat twice)', collectMembers, [] as string[])
    .option('--cursor <token>', 'Opaque pagination cursor from meta.nextCursor')
    .option('--limit <n>', 'Messages per page (default 50, max 500)')
  addSharedOptions(betweenCmd)
  betweenCmd.action(async (options: CommonMessageOptions & { member: string[] }) => {
    await runQuery('messages.between', options, async (format) => {
      assertRawFormatCompatible(format, options)
      if (options.member.length !== 2) {
        throw new QueryError({
          code: 'INVALID_ARGUMENT',
          message: `--member must be given exactly twice (got ${options.member.length})`,
          hint: 'Example: messages between --member me --member 小红',
        })
      }
      const ctx = createQueryContext(options)
      try {
        assertRawAllowed(ctx, options)
        const time = parseTimeOptions(options)
        const memberA = resolveMember(ctx.db, options.member[0])
        const memberB = resolveMember(ctx.db, options.member[1])
        const limit = parseLimit(options.limit, 50, 500, '--limit')
        const excludeKeywords = options.raw ? undefined : ctx.preprocessConfig.blacklistKeywords

        const fingerprint = queryFingerprint({
          command: 'messages.between',
          session: ctx.session.id,
          members: [memberA.id, memberB.id],
          startTs: time.startTs ?? null,
          endTs: time.endTs ?? null,
          exclude: excludeKeywords ?? [],
        })
        const offset = options.cursor ? decodeCursor(options.cursor, fingerprint) : 0

        const timeFilter =
          time.startTs !== undefined || time.endTs !== undefined
            ? { startTs: time.startTs ?? 0, endTs: time.endTs ?? Math.floor(Date.now() / 1000) }
            : undefined
        const result = getConversationBetween(ctx.db, memberA.id, memberB.id, timeFilter, limit, {
          offset,
          excludeKeywords,
        })

        const returned = result.messages.length
        const hasMore = offset + returned < result.total
        const meta: Record<string, unknown> = {
          session: ctx.session,
          timeRange: time.meta,
          members: [memberA, memberB],
          totalHits: result.total,
          returnedHits: returned,
          hasMore,
          ...(hasMore ? { nextCursor: encodeCursor(offset + returned, fingerprint) } : {}),
        }

        return buildMessagesResult(format, ctx, options, result.messages, meta, {
          strategy: 'keep_last',
        })
      } finally {
        ctx.close()
      }
    })
  })
}

function collectMembers(value: string, previous: string[]): string[] {
  return [...previous, value]
}
