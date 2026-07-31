import { createHash } from 'node:crypto'
import { generateMessageKey, getSessionMeta, isChatSessionDb, type DatabaseAdapter } from '@openchatlab/core'
import { streamParseFile, type ParsedMeta } from '@openchatlab/parser'
import { MessageType } from '@openchatlab/shared-types'
import { normalizeImportTimestamp } from './incremental-importer'
import type { ImportProgressCallback } from './streaming-importer'

const MATCH_WINDOW_SIZE = 5

export type AutoImportMatchMethod = 'source-session-id' | 'stable-id' | 'trailing-messages'
export type AutoImportCreateReason = 'no-match' | 'ambiguous'

export type AutoImportDecision =
  | { action: 'incremental'; sessionId: string; matchedBy: AutoImportMatchMethod }
  | { action: 'create'; reason: AutoImportCreateReason }

export interface AutoImportTargetPlan {
  decision: AutoImportDecision
  concurrencyKey: string
  exclusive: boolean
  coalesceCreate: boolean
}

export interface AutoImportMatcherDeps {
  listSessionIds(): string[]
  openReadonly(sessionId: string): DatabaseAdapter
  onProgress?: ImportProgressCallback
}

function buildPrivateIdentity(ownerId: string | null | undefined, memberIds: Iterable<string>): string | null {
  if (!ownerId) return null
  const ids = [...new Set(memberIds)].filter((id) => id && id.toLowerCase() !== 'system').sort()
  return ids.length > 0 ? `${ownerId}\0${ids.join('\0')}` : null
}

function isBusinessMessage(type: number, content: string | null): boolean {
  return type !== MessageType.SYSTEM && type !== MessageType.RECALL && Boolean(content?.trim())
}

function addMessageWindow(
  recentKeys: string[],
  windows: Set<string>,
  message: { timestamp: unknown; senderPlatformId: string; type: number; content: string | null }
): void {
  if (!message.senderPlatformId || !isBusinessMessage(message.type, message.content)) return
  const timestamp = normalizeImportTimestamp(message.timestamp)
  if (timestamp === null) return

  recentKeys.push(generateMessageKey(timestamp, message.senderPlatformId, message.content))
  if (recentKeys.length > MATCH_WINDOW_SIZE) recentKeys.shift()
  if (recentKeys.length === MATCH_WINDOW_SIZE) windows.add(recentKeys.join(''))
}

export async function resolveAutoImportTarget(
  filePath: string,
  deps: AutoImportMatcherDeps,
  formatOptions?: Record<string, unknown>
): Promise<AutoImportDecision> {
  return (await resolveAutoImportTargetPlan(filePath, deps, formatOptions)).decision
}

export async function resolveAutoImportTargetPlan(
  filePath: string,
  deps: AutoImportMatcherDeps,
  formatOptions?: Record<string, unknown>
): Promise<AutoImportTargetPlan> {
  let sourceMeta: ParsedMeta | null = null
  const sourceMemberIds = new Set<string>()
  const sourceWindows = new Set<string>()
  const recentSourceKeys: string[] = []
  const { formatId, ...parserOptions } = formatOptions ?? {}

  await streamParseFile(
    filePath,
    {
      formatOptions: parserOptions,
      onProgress: deps.onProgress ?? (() => {}),
      onMeta: (meta) => {
        sourceMeta = meta
      },
      onMembers: (members) => {
        for (const member of members) sourceMemberIds.add(member.platformId)
      },
      onMessageBatch: (messages) => {
        for (const message of messages) {
          sourceMemberIds.add(message.senderPlatformId)
          addMessageWindow(recentSourceKeys, sourceWindows, message)
        }
      },
    },
    typeof formatId === 'string' ? formatId : undefined
  )

  if (!sourceMeta) throw new Error('Import source did not provide metadata')

  const meta = sourceMeta as ParsedMeta
  const privateIdentity = meta.type === 'private' ? buildPrivateIdentity(meta.ownerId, sourceMemberIds) : null
  const hasStableIdentity = Boolean(meta.groupId || privateIdentity)
  const stableIdentity = meta.groupId
    ? `group\0${meta.groupId}`
    : privateIdentity
      ? `private\0${privateIdentity}`
      : null
  const stableConcurrencyKey = stableIdentity
    ? `source:${createHash('sha256').update(`${meta.platform}\0${meta.type}\0${stableIdentity}`).digest('hex')}`
    : null

  const stableMatches: string[] = []
  const trailingMatches: string[] = []
  for (const sessionId of deps.listSessionIds()) {
    let db: DatabaseAdapter | null = null
    try {
      db = deps.openReadonly(sessionId)
      // Desktop 的数据库目录还可能包含配置库等非聊天 DB，匹配前统一排除。
      if (!isChatSessionDb(db)) continue

      const candidate = getSessionMeta(db)
      if (candidate?.platform !== meta.platform || candidate.type !== meta.type) continue

      const groupMatches = Boolean(meta.groupId && candidate.groupId === meta.groupId)
      const memberRows = privateIdentity
        ? (db.prepare("SELECT platform_id FROM member WHERE LOWER(platform_id) != 'system'").all() as Array<{
            platform_id: string
          }>)
        : []
      const candidatePrivateIdentity = privateIdentity
        ? buildPrivateIdentity(
            candidate.ownerId,
            memberRows.map((row) => row.platform_id)
          )
        : null

      if (groupMatches || (privateIdentity && candidatePrivateIdentity === privateIdentity)) {
        stableMatches.push(sessionId)
      }

      if (sourceWindows.size > 0) {
        const rows = db
          .prepare(
            `SELECT msg.ts, member.platform_id, msg.type, msg.content
             FROM message msg
             JOIN member ON member.id = msg.sender_id
             WHERE msg.type NOT IN (?, ?)
               AND NULLIF(TRIM(msg.content), '') IS NOT NULL
             ORDER BY msg.ts DESC, msg.id DESC
             LIMIT ?`
          )
          .all(MessageType.SYSTEM, MessageType.RECALL, MATCH_WINDOW_SIZE) as Array<{
          ts: number
          platform_id: string
          type: number
          content: string
        }>

        if (rows.length === MATCH_WINDOW_SIZE) {
          const signature = rows
            .reverse()
            .map((row) => generateMessageKey(row.ts, row.platform_id, row.content))
            .join('')
          if (sourceWindows.has(signature)) trailingMatches.push(sessionId)
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to inspect import candidate ${JSON.stringify(sessionId)}: ${detail}`, {
        cause: error,
      })
    } finally {
      db?.close()
    }
  }

  if (hasStableIdentity) {
    if (meta.sourceSessionId && stableMatches.includes(meta.sourceSessionId)) {
      return {
        decision: { action: 'incremental', sessionId: meta.sourceSessionId, matchedBy: 'source-session-id' },
        concurrencyKey: `session:${meta.sourceSessionId}`,
        exclusive: false,
        coalesceCreate: false,
      }
    }
    if (stableMatches.length === 1) {
      return {
        decision: { action: 'incremental', sessionId: stableMatches[0], matchedBy: 'stable-id' },
        concurrencyKey: `session:${stableMatches[0]}`,
        exclusive: false,
        coalesceCreate: false,
      }
    }
  }

  // 稳定身份缺失、漂移或产生多个候选时，仍只接受唯一的 5 条连续消息重叠。
  if (meta.sourceSessionId && trailingMatches.includes(meta.sourceSessionId)) {
    return {
      decision: { action: 'incremental', sessionId: meta.sourceSessionId, matchedBy: 'source-session-id' },
      concurrencyKey: `session:${meta.sourceSessionId}`,
      exclusive: false,
      coalesceCreate: false,
    }
  }
  if (trailingMatches.length === 1) {
    return {
      decision: { action: 'incremental', sessionId: trailingMatches[0], matchedBy: 'trailing-messages' },
      concurrencyKey: `session:${trailingMatches[0]}`,
      exclusive: false,
      coalesceCreate: false,
    }
  }
  const ambiguous = stableMatches.length > 1 || trailingMatches.length > 1
  const decision: AutoImportDecision = { action: 'create', reason: ambiguous ? 'ambiguous' : 'no-match' }
  if (!ambiguous && stableConcurrencyKey) {
    return {
      decision,
      concurrencyKey: stableConcurrencyKey,
      exclusive: false,
      coalesceCreate: true,
    }
  }
  return {
    decision,
    concurrencyKey: 'unresolved',
    exclusive: true,
    coalesceCreate: false,
  }
}
