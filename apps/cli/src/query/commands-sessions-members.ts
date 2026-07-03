/**
 * sessions / members query command groups.
 *
 * Parent actions keep the legacy top-level behavior (`chatlab sessions`,
 * `chatlab members <session-id>`) as deprecated aliases for one major version.
 */

import type { Command } from 'commander'
import {
  getSessionMeta,
  getSessionOverview,
  getMembersWithAliases,
  getMemberNameHistory,
  getMembers,
} from '@openchatlab/core'
import { initRuntime } from '../runtime'
import { runQuery } from './runner'
import { createQueryContext } from './context'
import { resolveMember } from './resolve'
import { epochToIso, parseLimit } from './parse'

function epochOrNull(ts: number | null): string | null {
  return ts == null ? null : epochToIso(ts)
}

export function registerSessionCommands(program: Command): void {
  const sessionsCmd = program
    .command('sessions')
    .description('Chat sessions (list, show)')
    .option('--format <format>', 'Output format (table|json for legacy list; agent|json|text for subcommands)')
    .action((options: { format?: string }) => {
      // legacy alias: `chatlab sessions [--format table|json]`
      console.error('[Deprecated] `chatlab sessions` — use `chatlab sessions list`; alias kept for one major version')
      legacySessionsList(options)
    })

  sessionsCmd
    .command('list')
    .description('List imported chat sessions')
    .option('--query <kw>', 'Filter by session name substring')
    .option('--platform <p>', 'Filter by platform id')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(async (options: { query?: string; platform?: string; format?: string }) => {
      await runQuery('sessions.list', options, async () => {
        const { dbManager } = initRuntime()
        try {
          const items = dbManager
            .listSessionIds()
            .map((id) => {
              const db = dbManager.open(id)
              if (!db) return null
              const meta = getSessionMeta(db)
              if (!meta) return null
              const overview = getSessionOverview(db)
              return {
                id,
                name: meta.name,
                platform: meta.platform,
                type: meta.type,
                totalMessages: overview.totalMessages,
                totalMembers: overview.totalMembers,
                firstMessage: epochOrNull(overview.firstMessageTs),
                lastMessage: epochOrNull(overview.lastMessageTs),
              }
            })
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .filter((s) => (options.query ? s.name.includes(options.query) : true))
            .filter((s) => (options.platform ? s.platform === options.platform : true))

          return {
            data: { items },
            meta: { returned: items.length },
            renderText: () =>
              items
                .map(
                  (s) =>
                    `${s.id}  ${s.name}\n  ${s.platform} | ${s.type} | ${s.totalMembers} members | ${s.totalMessages} messages`
                )
                .join('\n') || 'No chat sessions found.',
          }
        } finally {
          dbManager.closeAll()
        }
      })
    })

  sessionsCmd
    .command('show')
    .description('Show one session in detail')
    .option('--session <ref>', 'Session id or unique name')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(async (options: { session?: string; format?: string }) => {
      await runQuery('sessions.show', options, async () => {
        const ctx = createQueryContext(options)
        try {
          const meta = getSessionMeta(ctx.db)!
          const overview = getSessionOverview(ctx.db)
          const data = {
            id: ctx.session.id,
            name: meta.name,
            platform: meta.platform,
            type: meta.type,
            totalMessages: overview.totalMessages,
            totalMembers: overview.totalMembers,
            firstMessage: epochOrNull(overview.firstMessageTs),
            lastMessage: epochOrNull(overview.lastMessageTs),
          }
          return {
            data,
            meta: { session: ctx.session },
            renderText: () =>
              `${data.name} (${data.id})\n` +
              `Platform: ${data.platform} | Type: ${data.type}\n` +
              `Messages: ${data.totalMessages} | Members: ${data.totalMembers}\n` +
              `Range: ${data.firstMessage ?? '-'} ~ ${data.lastMessage ?? '-'}`,
          }
        } finally {
          ctx.close()
        }
      })
    })
}

export function registerMemberCommands(program: Command): void {
  const membersCmd = program
    .command('members')
    .description('Session members (list, history)')
    .argument('[session-id]', 'legacy: session id (deprecated alias)')
    .option('--format <format>', 'Output format')
    .action((sessionId: string | undefined, options: { format?: string }, command: Command) => {
      if (!sessionId) {
        command.help({ error: false })
        return
      }
      console.error(
        '[Deprecated] `chatlab members <session-id>` — use `chatlab members list --session <id>`; alias kept for one major version'
      )
      legacyMembersList(sessionId, options)
    })

  membersCmd
    .command('list')
    .description('List session members')
    .option('--session <ref>', 'Session id or unique name')
    .option('--query <kw>', 'Filter by member name substring')
    .option('--sort <by>', 'Sort by: messages|name', 'messages')
    .option('--limit <n>', 'Max members to return (default 50)')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(async (options: { session?: string; query?: string; sort?: string; limit?: string; format?: string }) => {
      await runQuery('members.list', options, async () => {
        const ctx = createQueryContext(options)
        try {
          const limit = parseLimit(options.limit, 50, 500, '--limit')
          let members = getMembersWithAliases(ctx.db).map((m) => ({
            id: m.id,
            name: m.groupNickname || m.accountName || m.platformId,
            ...(m.aliases.length > 0 ? { aliases: m.aliases } : {}),
            messageCount: m.messageCount,
          }))
          if (options.query) {
            const kw = options.query
            members = members.filter((m) => m.name.includes(kw) || m.aliases?.some((a) => a.includes(kw)))
          }
          if (options.sort === 'name') {
            members.sort((a, b) => a.name.localeCompare(b.name))
          }
          const total = members.length
          const items = members.slice(0, limit)
          return {
            data: { items },
            meta: { session: ctx.session, total, returned: items.length },
            renderText: () =>
              items.map((m, i) => `${i + 1}. ${m.name} (#${m.id}) - ${m.messageCount} messages`).join('\n') ||
              'No members.',
          }
        } finally {
          ctx.close()
        }
      })
    })

  membersCmd
    .command('history')
    .description('Show name change history for a member')
    .requiredOption('--member <ref>', 'Member id, exact name, or `me`')
    .option('--session <ref>', 'Session id or unique name')
    .option('--format <format>', 'Output format: agent|json|text')
    .action(async (options: { member: string; session?: string; format?: string }) => {
      await runQuery('members.history', options, async () => {
        const ctx = createQueryContext(options)
        try {
          const member = resolveMember(ctx.db, options.member)
          const items = getMemberNameHistory(ctx.db, member.id).map((h) => ({
            nameType: h.nameType,
            name: h.name,
            since: epochToIso(h.startTs),
            until: h.endTs == null ? null : epochToIso(h.endTs),
          }))
          return {
            data: { items },
            meta: { session: ctx.session, member, returned: items.length },
            renderText: () =>
              items.map((h) => `${h.since} ~ ${h.until ?? 'present'}  [${h.nameType}] ${h.name}`).join('\n') ||
              'No name changes recorded.',
          }
        } finally {
          ctx.close()
        }
      })
    })
}

// ==================== Legacy aliases (output kept byte-compatible) ====================

function legacySessionsList(options: { format?: string }): void {
  const { dbManager } = initRuntime()
  const sessionIds = dbManager.listSessionIds()

  if (sessionIds.length === 0) {
    console.log('No chat sessions found.')
    console.log(`Data directory: ${dbManager['pathProvider'].getUserDataDir()}`)
    dbManager.closeAll()
    return
  }

  const sessions = sessionIds
    .map((id) => {
      const db = dbManager.open(id)
      if (!db) return null
      const meta = getSessionMeta(db)
      if (!meta) return null
      const overview = getSessionOverview(db)
      return { id, ...meta, ...overview }
    })
    .filter(Boolean)

  if (options.format === 'json') {
    console.log(JSON.stringify(sessions, null, 2))
  } else {
    console.log(`${sessions.length} session(s) found:\n`)
    for (const s of sessions) {
      if (!s) continue
      const range =
        s.firstMessageTs && s.lastMessageTs
          ? `${new Date(s.firstMessageTs * 1000).toLocaleDateString()} ~ ${new Date(s.lastMessageTs * 1000).toLocaleDateString()}`
          : ''
      console.log(`  ${s.name}`)
      console.log(`    ID: ${s.id}`)
      console.log(
        `    Platform: ${s.platform} | Type: ${s.type} | Members: ${s.totalMembers} | Messages: ${s.totalMessages}`
      )
      if (range) console.log(`    Range: ${range}`)
      console.log()
    }
  }

  dbManager.closeAll()
}

function legacyMembersList(sessionId: string, options: { format?: string }): void {
  const { dbManager } = initRuntime()
  const db = dbManager.open(sessionId)
  if (!db) {
    console.error(`Session ${sessionId} not found`)
    process.exit(1)
  }

  const members = getMembers(db)

  if (options.format === 'json') {
    console.log(JSON.stringify(members, null, 2))
  } else {
    console.log(`${members.length} member(s):\n`)
    for (const [i, m] of members.entries()) {
      console.log(`  ${i + 1}. ${m.name} (${m.platformId}) - ${m.messageCount} messages`)
    }
  }

  dbManager.closeAll()
}
