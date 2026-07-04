/**
 * stats query command group: overview / activity / time / keywords / response.
 *
 * `stats keywords` privacy prerequisites (design §15.4): blacklist keywords are
 * pushed down to SQL at message level, and the resulting vocabulary is filtered
 * through the user's desensitize rules (over-fetch then trim, so filtered-out
 * words don't leave the top-N short).
 */

import type { Command } from 'commander'
import {
  getSessionMeta,
  getSessionOverview,
  getMemberActivity,
  getHourlyActivity,
  getWeekdayActivity,
  getDailyActivity,
  getMonthlyActivity,
  getChatOverview,
  computeResponseTimeStats,
  executeParameterizedSql,
} from '@openchatlab/core'
import type { SupportedLocale } from '@openchatlab/core'
import { computeWordFrequency, desensitizeText } from '@openchatlab/node-runtime'
import { initRuntime } from '../runtime'
import { runQuery } from './runner'
import { createQueryContext } from './context'
import { resolveMember } from './resolve'
import { parseTimeOptions, parseLimit, epochToIso } from './parse'
import { QueryError } from './envelope'

interface StatsTimeOptions {
  session?: string
  since?: string
  until?: string
  last?: string
  format?: string
}

function addStatsOptions(cmd: Command): Command {
  return cmd
    .option('--session <ref>', 'Session id or unique name (auto-selected when only one exists)')
    .option('--since <t>', 'Start time: YYYY-MM-DD, ISO 8601, today, yesterday')
    .option('--until <t>', 'End time (date-only values include the whole day)')
    .option('--last <dur>', 'Relative window: <N>h|d|w')
    .option('--format <format>', 'Output format: agent|json|text')
}

function toTimeFilter(time: ReturnType<typeof parseTimeOptions>): { startTs: number; endTs: number } | undefined {
  if (time.startTs === undefined && time.endTs === undefined) return undefined
  return { startTs: time.startTs ?? 0, endTs: time.endTs ?? Math.floor(Date.now() / 1000) }
}

export function responseStatsMessagesSql(): string {
  return `SELECT msg.id, msg.sender_id, COALESCE(m.group_nickname, m.account_name) AS name, msg.ts
           FROM message msg
           JOIN member m ON msg.sender_id = m.id
           WHERE msg.type = 0 AND msg.ts >= @startTs
           ORDER BY msg.ts ASC, msg.id ASC`
}

export function registerStatsCommands(program: Command): void {
  const statsCmd = program
    .command('stats')
    .description('Session statistics (overview, activity, time, keywords, response)')
    .argument('[session-id]', 'legacy: session id (deprecated alias)')
    .option('--format <format>', 'Output format')
    .option('--top <n>', 'legacy: top N members', '10')
    .action((sessionId: string | undefined, options: { format?: string; top: string }, command: Command) => {
      if (!sessionId) {
        command.help({ error: false })
        return
      }
      console.error(
        '[Deprecated] `chatlab stats <session-id>` — use `chatlab stats overview --session <id>`; alias kept for one major version'
      )
      legacyStats(sessionId, options)
    })

  // ---------- stats overview ----------
  statsCmd
    .command('overview')
    .description('Session overview: totals, time range, top members')
    .option('--session <ref>', 'Session id or unique name')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(async (options: { session?: string; format?: string }) => {
      await runQuery('stats.overview', options, async () => {
        const ctx = createQueryContext(options)
        try {
          const overview = getChatOverview(ctx.db)
          if (!overview) {
            throw new QueryError({ code: 'SESSION_NOT_FOUND', message: 'Session metadata missing' })
          }
          const data = {
            name: overview.name,
            platform: overview.platform,
            type: overview.type,
            totalMessages: overview.totalMessages,
            totalMembers: overview.totalMembers,
            firstMessage: overview.firstMessageTs == null ? null : epochToIso(overview.firstMessageTs),
            lastMessage: overview.lastMessageTs == null ? null : epochToIso(overview.lastMessageTs),
            topMembers: overview.topMembers,
            summaryCount: overview.summaryCount,
          }
          return {
            data,
            meta: { session: ctx.session },
            renderText: () =>
              `${data.name}\nMessages: ${data.totalMessages} | Members: ${data.totalMembers}\n` +
              `Range: ${data.firstMessage ?? '-'} ~ ${data.lastMessage ?? '-'}\n` +
              data.topMembers.map((m, i) => `  ${i + 1}. ${m.name} - ${m.count}`).join('\n'),
          }
        } finally {
          ctx.close()
        }
      })
    })

  // ---------- stats activity ----------
  const activityCmd = statsCmd.command('activity').description('Member activity ranking')
  addStatsOptions(activityCmd)
  activityCmd.option('--top <n>', 'Top N members (default 10, max 100)')
  activityCmd.action(async (options: StatsTimeOptions & { top?: string }) => {
    await runQuery('stats.activity', options, async () => {
      const ctx = createQueryContext(options)
      try {
        const time = parseTimeOptions(options)
        const top = parseLimit(options.top, 10, 100, '--top')
        const items = getMemberActivity(ctx.db, toTimeFilter(time))
          .slice(0, top)
          .map((m) => ({ id: m.memberId, name: m.name, messageCount: m.messageCount, percentage: m.percentage }))
        return {
          data: { items },
          meta: { session: ctx.session, timeRange: time.meta, returned: items.length },
          renderText: () =>
            items.map((m, i) => `${i + 1}. ${m.name} - ${m.messageCount} messages (${m.percentage}%)`).join('\n') ||
            'No activity.',
        }
      } finally {
        ctx.close()
      }
    })
  })

  // ---------- stats time ----------
  const timeCmd = statsCmd.command('time').description('Message distribution over time')
  addStatsOptions(timeCmd)
  timeCmd.requiredOption('--by <unit>', 'Bucket unit: hour|weekday|day|month')
  timeCmd.action(async (options: StatsTimeOptions & { by: string }) => {
    await runQuery('stats.time', options, async () => {
      const ctx = createQueryContext(options)
      try {
        const time = parseTimeOptions(options)
        const filter = toTimeFilter(time)
        let items: unknown[]
        switch (options.by) {
          case 'hour':
            items = getHourlyActivity(ctx.db, filter)
            break
          case 'weekday':
            items = getWeekdayActivity(ctx.db, filter)
            break
          case 'day':
            items = getDailyActivity(ctx.db, filter)
            break
          case 'month':
            items = getMonthlyActivity(ctx.db, filter)
            break
          default:
            throw new QueryError({
              code: 'INVALID_ARGUMENT',
              message: `Invalid --by value: ${options.by}`,
              hint: 'Supported: hour, weekday, day, month',
            })
        }
        return {
          data: { items },
          meta: { session: ctx.session, timeRange: time.meta, by: options.by, returned: items.length },
        }
      } finally {
        ctx.close()
      }
    })
  })

  // ---------- stats keywords ----------
  const keywordsCmd = statsCmd.command('keywords').description('High-frequency words (privacy-filtered)')
  addStatsOptions(keywordsCmd)
  keywordsCmd.option('--top <n>', 'Top N words (default 20, max 100)')
  keywordsCmd.option('--member <ref>', 'Filter by sender (member id, exact name, or `me`)')
  keywordsCmd.action(async (options: StatsTimeOptions & { top?: string; member?: string }) => {
    await runQuery('stats.keywords', options, async () => {
      const ctx = createQueryContext(options)
      try {
        const time = parseTimeOptions(options)
        const top = parseLimit(options.top, 20, 100, '--top')
        const member = options.member ? resolveMember(ctx.db, options.member) : undefined
        // over-fetch so vocabulary-level desensitize filtering doesn't leave top-N short
        const fetchN = Math.max(top * 3, top + 20)

        let result
        try {
          result = computeWordFrequency(ctx.db, {
            sessionId: ctx.session.id,
            locale: ctx.locale as SupportedLocale,
            timeFilter: toTimeFilter(time),
            memberId: member?.id,
            topN: fetchN,
            excludeKeywords: ctx.preprocessConfig.blacklistKeywords,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (/jieba|segment/i.test(message)) {
            return {
              data: { items: [], status: 'segmentation_unavailable' },
              meta: {
                session: ctx.session,
                hint: 'Word segmentation engine unavailable (optional dependency @node-rs/jieba failed to load)',
              },
            }
          }
          throw err
        }

        const enabledRules = ctx.preprocessConfig.desensitize
          ? ctx.preprocessConfig.desensitizeRules.filter((r) => r.enabled)
          : []
        const items = result.words
          .filter((w) => enabledRules.length === 0 || desensitizeText(w.word, enabledRules) === w.word)
          .slice(0, top)

        return {
          data: { items },
          meta: {
            session: ctx.session,
            timeRange: time.meta,
            ...(member ? { member } : {}),
            totalMessages: result.totalMessages,
            uniqueWords: result.uniqueWords,
            returned: items.length,
            ...(items.length === 0 && result.totalMessages > 0
              ? {
                  hint: 'No words extracted; the zh-CN segmentation dictionary may be missing (downloadable in the ChatLab app)',
                }
              : {}),
          },
          renderText: () => items.map((w, i) => `${i + 1}. ${w.word} (${w.count})`).join('\n') || 'No words.',
        }
      } finally {
        ctx.close()
      }
    })
  })

  // ---------- stats response ----------
  const responseCmd = statsCmd.command('response').description('Reply speed ranking (median response gap)')
  responseCmd
    .option('--session <ref>', 'Session id or unique name')
    .option('--last <dur>', 'Relative window: <N>h|d|w (default 30d)')
    .option('--top <n>', 'Top N responders (default 10, max 100)')
    .option('--format <format>', 'Output format: agent|json|text')
  responseCmd.action(async (options: { session?: string; last?: string; top?: string; format?: string }) => {
    await runQuery('stats.response', options, async () => {
      const ctx = createQueryContext(options)
      try {
        const time = parseTimeOptions({ last: options.last ?? '30d' })
        const top = parseLimit(options.top, 10, 100, '--top')
        const rows = executeParameterizedSql<{ sender_id: number; name: string; ts: number }>(
          ctx.db,
          responseStatsMessagesSql(),
          { startTs: time.startTs ?? 0 }
        )
        const items = computeResponseTimeStats(
          rows.map((r) => ({ senderId: r.sender_id, name: r.name, ts: r.ts })),
          top
        )
        return {
          data: { items },
          meta: { session: ctx.session, timeRange: time.meta, returned: items.length },
          renderText: () =>
            items
              .map(
                (s, i) => `${i + 1}. ${s.name} - median ${s.medianSeconds}s, avg ${s.avgSeconds}s (${s.responseCount})`
              )
              .join('\n') || 'Not enough response data.',
        }
      } finally {
        ctx.close()
      }
    })
  })
}

// ==================== Legacy alias (output kept byte-compatible) ====================

function legacyStats(sessionId: string, options: { format?: string; top: string }): void {
  const { dbManager } = initRuntime()
  const db = dbManager.open(sessionId)
  if (!db) {
    console.error(`Session ${sessionId} not found`)
    process.exit(1)
  }

  const meta = getSessionMeta(db)
  const overview = getSessionOverview(db)
  const topMembers = getMemberActivity(db).slice(0, parseInt(options.top))

  if (options.format === 'json') {
    console.log(JSON.stringify({ meta, overview, topMembers }, null, 2))
  } else {
    console.log(`\nSession: ${meta?.name}`)
    console.log(`Platform: ${meta?.platform} | Type: ${meta?.type}`)
    console.log(`Total messages: ${overview.totalMessages}`)
    console.log(`Total members: ${overview.totalMembers}`)
    const range =
      overview.firstMessageTs && overview.lastMessageTs
        ? `${new Date(overview.firstMessageTs * 1000).toLocaleDateString()} ~ ${new Date(overview.lastMessageTs * 1000).toLocaleDateString()}`
        : 'Unknown'
    console.log(`Time range: ${range}`)

    if (topMembers.length > 0) {
      console.log(`\nActivity ranking (Top ${options.top}):`)
      for (const [i, m] of topMembers.entries()) {
        console.log(`  ${i + 1}. ${m.name} - ${m.messageCount} messages (${m.percentage}%)`)
      }
    }
  }

  dbManager.closeAll()
}
