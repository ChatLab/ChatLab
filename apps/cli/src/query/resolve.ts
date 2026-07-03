/**
 * Session and member reference resolution (design §4, §5.2).
 *
 * ID-first, name-tolerant: exact id wins, then unique name match. Ambiguity is a
 * structured error (exit code 4) with candidates so agents can retry with the id.
 */

import type { DatabaseAdapter } from '@openchatlab/core'
import { getSessionMeta, getMembersWithAliases, resolveOwnerMember } from '@openchatlab/core'
import { QueryError } from './envelope'

export interface ResolvedSession {
  id: string
  name: string
  db: DatabaseAdapter
}

export interface SessionSource {
  listSessionIds(): string[]
  open(id: string): DatabaseAdapter | null | undefined
}

interface SessionCandidate {
  id: string
  name: string
  platform: string
}

function listSessionCandidates(source: SessionSource): Array<SessionCandidate & { db: DatabaseAdapter }> {
  const result: Array<SessionCandidate & { db: DatabaseAdapter }> = []
  for (const id of source.listSessionIds()) {
    const db = source.open(id)
    if (!db) continue
    const meta = getSessionMeta(db)
    if (!meta) continue
    result.push({ id, name: meta.name, platform: meta.platform, db })
  }
  return result
}

/**
 * Resolve --session <ref> (session id or unique name). Without a ref, a single
 * local session is auto-selected; multiple sessions require disambiguation.
 */
export function resolveSession(source: SessionSource, ref?: string): ResolvedSession {
  if (ref) {
    const direct = source.open(ref)
    if (direct && getSessionMeta(direct)) {
      const meta = getSessionMeta(direct)!
      return { id: ref, name: meta.name, db: direct }
    }
  }

  const sessions = listSessionCandidates(source)

  if (!ref) {
    if (sessions.length === 1) {
      return { id: sessions[0].id, name: sessions[0].name, db: sessions[0].db }
    }
    if (sessions.length === 0) {
      throw new QueryError({
        code: 'SESSION_NOT_FOUND',
        message: 'No chat sessions found',
        hint: 'Import a chat export first (chatlab import <file>)',
      })
    }
    throw new QueryError({
      code: 'SESSION_AMBIGUOUS',
      message: `${sessions.length} sessions available, --session is required`,
      hint: 'Retry with --session <id>',
      candidates: sessions.map(({ id, name, platform }) => ({ id, name, platform })),
    })
  }

  const nameMatches = sessions.filter((s) => s.name === ref)
  if (nameMatches.length === 1) {
    return { id: nameMatches[0].id, name: nameMatches[0].name, db: nameMatches[0].db }
  }
  if (nameMatches.length > 1) {
    throw new QueryError({
      code: 'SESSION_AMBIGUOUS',
      message: `Session name '${ref}' matches ${nameMatches.length} sessions`,
      hint: 'Retry with --session <id>',
      candidates: nameMatches.map(({ id, name, platform }) => ({ id, name, platform })),
    })
  }

  const partial = sessions.filter((s) => s.name.includes(ref))
  if (partial.length > 0) {
    throw new QueryError({
      code: 'SESSION_AMBIGUOUS',
      message: `Session '${ref}' not found, ${partial.length} similar session(s) exist`,
      hint: 'Retry with --session <id>',
      candidates: partial.map(({ id, name, platform }) => ({ id, name, platform })),
    })
  }

  throw new QueryError({
    code: 'SESSION_NOT_FOUND',
    message: `Session '${ref}' not found`,
    hint: 'Run `chatlab sessions list` to see available sessions',
  })
}

export interface ResolvedMember {
  id: number
  name: string
}

/**
 * Resolve --member <ref>: numeric id, exact name (current name or alias), or `me`
 * (owner profile). Ambiguous names return candidates for a two-step retry.
 */
export function resolveMember(db: DatabaseAdapter, ref: string): ResolvedMember {
  if (ref === 'me') {
    const owner = resolveOwnerMember(db)
    if (!owner) {
      throw new QueryError({
        code: 'MEMBER_NOT_FOUND',
        message: 'Owner profile is not configured for this session',
        hint: 'Set the owner in the ChatLab app, or use an explicit --member <id>',
      })
    }
    return { id: owner.id, name: owner.name }
  }

  const members = getMembersWithAliases(db)
  const displayName = (m: (typeof members)[number]) => m.groupNickname || m.accountName || m.platformId

  if (/^\d+$/.test(ref)) {
    const byId = members.find((m) => m.id === Number(ref))
    if (byId) return { id: byId.id, name: displayName(byId) }
    throw new QueryError({
      code: 'MEMBER_NOT_FOUND',
      message: `Member id ${ref} not found`,
      hint: 'Run `chatlab members list` to see available members',
    })
  }

  const exact = members.filter(
    (m) => m.groupNickname === ref || m.accountName === ref || m.aliases.includes(ref) || m.platformId === ref
  )
  if (exact.length === 1) {
    return { id: exact[0].id, name: displayName(exact[0]) }
  }

  const pool = exact.length > 1 ? exact : members.filter((m) => displayName(m).includes(ref))
  if (pool.length > 0) {
    throw new QueryError({
      code: 'MEMBER_AMBIGUOUS',
      message: `Member name '${ref}' matches ${pool.length} member(s)`,
      hint: 'Retry with --member <id>',
      candidates: pool.slice(0, 10).map((m) => ({ id: m.id, name: displayName(m), messages: m.messageCount })),
    })
  }

  throw new QueryError({
    code: 'MEMBER_NOT_FOUND',
    message: `Member '${ref}' not found`,
    hint: 'Run `chatlab members list` to see available members',
  })
}
