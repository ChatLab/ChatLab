import { createHash } from 'node:crypto'
import { generateMessageKey, getSessionMeta, isChatSessionDb, type DatabaseAdapter } from '@openchatlab/core'
import { streamParseFile, type ParsedMeta } from '@openchatlab/parser'
import { MessageType } from '@openchatlab/shared-types'
import { normalizeImportTimestamp, type SenderPlatformIdMapping } from './incremental-importer'
import { parsePlatformMessageId } from './message-deduplicator'
import type { ImportProgressCallback } from './streaming-importer'

const MATCH_WINDOW_SIZE = 5

export type AutoImportMatchMethod = 'source-session-id' | 'stable-id' | 'trailing-messages'
export type AutoImportCreateReason = 'no-match' | 'ambiguous'

export type AutoImportDecision =
  | {
      action: 'incremental'
      sessionId: string
      matchedBy: AutoImportMatchMethod
      platformMessageIdScope?: string
      senderPlatformIdMappings?: SenderPlatformIdMapping[]
    }
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

function buildPrivateIdentity(
  platform: string,
  ownerId: string | null | undefined,
  memberIds: Iterable<string>
): string | null {
  const sortedIds = [...new Set(memberIds)].filter((id) => id && id.toLowerCase() !== 'system').sort()
  const validOwnerId = ownerId && ownerId.toLowerCase() !== 'system' ? ownerId : null
  if (validOwnerId) {
    return sortedIds.length > 0 ? `owner\0${validOwnerId}\0members\0${sortedIds.join('\0')}` : null
  }
  return platform === 'qq' && sortedIds.length >= 2 ? `members\0${sortedIds.join('\0')}` : null
}

function isBusinessMessage(type: number, content: string | null): boolean {
  return type !== MessageType.SYSTEM && type !== MessageType.RECALL && Boolean(content?.trim())
}

function addMessageWindow(
  recentKeys: string[],
  windows: Set<string>,
  recentPlatformIdKeys: string[],
  platformIdWindows: Set<string>,
  platformIdSenders: Map<string, string | null>,
  recentExactPlatformIdKeys: string[],
  exactPlatformIdWindows: Set<string>,
  exactPlatformIdSenders: Map<string, string | null>,
  message: {
    platformMessageId?: string
    timestamp: unknown
    senderPlatformId: string
    type: number
    content: string | null
  }
): void {
  if (!message.senderPlatformId || !isBusinessMessage(message.type, message.content)) return
  const timestamp = normalizeImportTimestamp(message.timestamp)
  if (timestamp === null) return

  recentKeys.push(generateMessageKey(timestamp, message.senderPlatformId, message.content))
  if (recentKeys.length > MATCH_WINDOW_SIZE) recentKeys.shift()
  if (recentKeys.length === MATCH_WINDOW_SIZE) windows.add(recentKeys.join(''))

  const platformIdKey = generatePlatformMessageKey(message, timestamp)
  const exactPlatformIdKey = generatePlatformMessageKey(message, timestamp, false)
  if (!platformIdKey) {
    recentPlatformIdKeys.length = 0
    recentExactPlatformIdKeys.length = 0
    return
  }
  recordPlatformMessageSender(platformIdSenders, platformIdKey, message.senderPlatformId)
  recordPlatformMessageSender(exactPlatformIdSenders, exactPlatformIdKey ?? platformIdKey, message.senderPlatformId)
  recentPlatformIdKeys.push(platformIdKey)
  if (recentPlatformIdKeys.length > MATCH_WINDOW_SIZE) recentPlatformIdKeys.shift()
  if (recentPlatformIdKeys.length === MATCH_WINDOW_SIZE) platformIdWindows.add(recentPlatformIdKeys.join(''))

  recentExactPlatformIdKeys.push(exactPlatformIdKey ?? platformIdKey)
  if (recentExactPlatformIdKeys.length > MATCH_WINDOW_SIZE) recentExactPlatformIdKeys.shift()
  if (recentExactPlatformIdKeys.length === MATCH_WINDOW_SIZE) {
    exactPlatformIdWindows.add(recentExactPlatformIdKeys.join(''))
  }
}

function recordPlatformMessageSender(
  senders: Map<string, string | null>,
  messageKey: string,
  senderPlatformId: string
): void {
  if (!senders.has(messageKey)) {
    senders.set(messageKey, senderPlatformId)
  } else if (senders.get(messageKey) !== senderPlatformId) {
    senders.set(messageKey, null)
  }
}

function isUsablePlatformId(id: string | null | undefined): id is string {
  return Boolean(id && id.toLowerCase() !== 'system')
}

function deriveSenderPlatformIdMappings(
  sourceMemberIds: Iterable<string>,
  targetMemberIds: Iterable<string>,
  sourceSenders: string[],
  targetSenders: string[],
  sourceOwnerId?: string | null,
  targetOwnerId?: string | null,
  allowSingleRemainingPair = false
): SenderPlatformIdMapping[] | null {
  const sourceIds = new Set([...sourceMemberIds].filter(isUsablePlatformId))
  const targetIds = new Set([...targetMemberIds].filter(isUsablePlatformId))
  if (isUsablePlatformId(sourceOwnerId)) sourceIds.add(sourceOwnerId)
  if (isUsablePlatformId(targetOwnerId)) targetIds.add(targetOwnerId)

  const forward = new Map<string, string>()
  const reverse = new Map<string, string>()
  let hasDrift = false
  const addPair = (sourceId: string, targetId: string): boolean => {
    if (!sourceIds.has(sourceId) || !targetIds.has(targetId)) return false
    const existingTarget = forward.get(sourceId)
    const existingSource = reverse.get(targetId)
    if ((existingTarget && existingTarget !== targetId) || (existingSource && existingSource !== sourceId)) {
      return false
    }
    forward.set(sourceId, targetId)
    reverse.set(targetId, sourceId)
    hasDrift ||= sourceId !== targetId
    return true
  }

  if (
    isUsablePlatformId(sourceOwnerId) &&
    isUsablePlatformId(targetOwnerId) &&
    !addPair(sourceOwnerId, targetOwnerId)
  ) {
    return null
  }
  for (let index = 0; index < sourceSenders.length; index++) {
    if (!addPair(sourceSenders[index], targetSenders[index])) return null
  }

  if (!hasDrift) return []

  for (const sourceId of sourceIds) {
    if (!forward.has(sourceId) && targetIds.has(sourceId) && !reverse.has(sourceId)) {
      addPair(sourceId, sourceId)
    }
  }

  const remainingSourceIds = [...sourceIds].filter((id) => !forward.has(id))
  const remainingTargetIds = [...targetIds].filter((id) => !reverse.has(id))
  // In a two-party private chat, one proven participant leaves only one possible peer.
  // Group membership can change, so cardinality alone must not pair joined and departed members.
  if (allowSingleRemainingPair && remainingSourceIds.length === 1 && remainingTargetIds.length === 1) {
    addPair(remainingSourceIds[0], remainingTargetIds[0])
  }
  if ([...sourceIds].some((id) => !forward.has(id))) return null

  return [...forward]
    .filter(([sourceId, targetId]) => sourceId !== targetId)
    .map(([sourceId, targetId]) => ({ sourceId, targetId }))
}

function getCommonPlatformMessageIdScope(ids: Array<string | null>): string | undefined {
  let commonScope: string | undefined
  for (const id of ids) {
    if (!id) return undefined
    const { scope } = parsePlatformMessageId(id)
    if (!scope || (commonScope && scope !== commonScope)) return undefined
    commonScope = scope
  }
  return commonScope
}

function generatePlatformMessageKey(
  message: { platformMessageId?: string; type: number; content: string | null },
  timestamp: number,
  normalizeScope = true
): string | null {
  if (!message.platformMessageId) return null
  const parsedId = parsePlatformMessageId(message.platformMessageId)
  return generateMessageKey(
    timestamp,
    normalizeScope ? parsedId.rawId : message.platformMessageId,
    JSON.stringify([message.type, message.content || null])
  )
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
  const sourcePlatformIdWindows = new Set<string>()
  const sourcePlatformIdSenders = new Map<string, string | null>()
  const sourceExactPlatformIdWindows = new Set<string>()
  const sourceExactPlatformIdSenders = new Map<string, string | null>()
  const recentSourceKeys: string[] = []
  const recentSourcePlatformIdKeys: string[] = []
  const recentSourceExactPlatformIdKeys: string[] = []
  let sourceHasScopedPlatformMessageIds = false
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
          sourceHasScopedPlatformMessageIds ||= Boolean(
            (message.platformMessageId && parsePlatformMessageId(message.platformMessageId).scope) ||
            (message.replyToMessageId && parsePlatformMessageId(message.replyToMessageId).scope)
          )
          sourceMemberIds.add(message.senderPlatformId)
          addMessageWindow(
            recentSourceKeys,
            sourceWindows,
            recentSourcePlatformIdKeys,
            sourcePlatformIdWindows,
            sourcePlatformIdSenders,
            recentSourceExactPlatformIdKeys,
            sourceExactPlatformIdWindows,
            sourceExactPlatformIdSenders,
            message
          )
        }
      },
    },
    typeof formatId === 'string' ? formatId : undefined
  )

  if (!sourceMeta) throw new Error('Import source did not provide metadata')

  const meta = sourceMeta as ParsedMeta
  const sourceHasValidOwner = Boolean(meta.ownerId && meta.ownerId.toLowerCase() !== 'system')
  // QCE sources intentionally omit owner metadata because their UID/UIN namespaces
  // cannot be mapped reliably. Match those sources by participants even when an
  // owner profile has since populated the existing session's owner_id.
  const matchQqPrivateByMembers = meta.platform === 'qq' && meta.type === 'private' && !sourceHasValidOwner
  const privateIdentity =
    meta.type === 'private' ? buildPrivateIdentity(meta.platform, meta.ownerId, sourceMemberIds) : null
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
  const trailingMatches: Array<{
    sessionId: string
    platformMessageIdScope?: string
    senderPlatformIdMappings?: SenderPlatformIdMapping[]
  }> = []
  for (const sessionId of deps.listSessionIds()) {
    let db: DatabaseAdapter | null = null
    try {
      db = deps.openReadonly(sessionId)
      // Desktop 的数据库目录还可能包含配置库等非聊天 DB，匹配前统一排除。
      if (!isChatSessionDb(db)) continue

      const candidate = getSessionMeta(db)
      if (candidate?.platform !== meta.platform || candidate.type !== meta.type) continue

      const groupMatches = Boolean(meta.groupId && candidate.groupId === meta.groupId)
      const memberRows =
        privateIdentity || sourcePlatformIdWindows.size > 0
          ? (db.prepare("SELECT platform_id FROM member WHERE LOWER(platform_id) != 'system'").all() as Array<{
              platform_id: string
            }>)
          : []
      const candidatePrivateIdentity = privateIdentity
        ? buildPrivateIdentity(
            candidate.platform,
            matchQqPrivateByMembers ? null : candidate.ownerId,
            memberRows.map((row) => row.platform_id)
          )
        : null

      if (groupMatches || (privateIdentity && candidatePrivateIdentity === privateIdentity)) {
        stableMatches.push(sessionId)
      }

      if (sourceWindows.size > 0 || sourcePlatformIdWindows.size > 0) {
        const rows = db
          .prepare(
            `SELECT msg.ts, member.platform_id, msg.type, msg.content, msg.platform_message_id
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
          platform_message_id: string | null
        }>

        if (rows.length === MATCH_WINDOW_SIZE) {
          const orderedRows = rows.reverse()
          const signature = orderedRows.map((row) => generateMessageKey(row.ts, row.platform_id, row.content)).join('')
          const platformIdKeys = orderedRows.map((row) =>
            generatePlatformMessageKey(
              {
                platformMessageId: row.platform_message_id || undefined,
                type: row.type,
                content: row.content,
              },
              row.ts
            )
          )
          const platformIdSignature = platformIdKeys.every((key): key is string => key !== null)
            ? platformIdKeys.join('')
            : null
          const exactPlatformIdKeys = orderedRows.map((row) =>
            generatePlatformMessageKey(
              {
                platformMessageId: row.platform_message_id || undefined,
                type: row.type,
                content: row.content,
              },
              row.ts,
              false
            )
          )
          const exactPlatformIdSignature = exactPlatformIdKeys.every((key): key is string => key !== null)
            ? exactPlatformIdKeys.join('')
            : null
          const platformIdsMatch = sourceHasScopedPlatformMessageIds
            ? exactPlatformIdSignature !== null && sourceExactPlatformIdWindows.has(exactPlatformIdSignature)
            : platformIdSignature !== null && sourcePlatformIdWindows.has(platformIdSignature)
          const contentMatches = !sourceHasScopedPlatformMessageIds && sourceWindows.has(signature)
          const matchedPlatformIdKeys = sourceHasScopedPlatformMessageIds ? exactPlatformIdKeys : platformIdKeys
          const sourceSenderLookup = sourceHasScopedPlatformMessageIds
            ? sourceExactPlatformIdSenders
            : sourcePlatformIdSenders
          const sourceSenders = platformIdsMatch
            ? matchedPlatformIdKeys.map((key) => (key ? sourceSenderLookup.get(key) : undefined))
            : []
          const senderPlatformIdMappings =
            platformIdsMatch && sourceSenders.every((sender): sender is string => Boolean(sender))
              ? deriveSenderPlatformIdMappings(
                  sourceMemberIds,
                  memberRows.map((row) => row.platform_id),
                  sourceSenders,
                  orderedRows.map((row) => row.platform_id),
                  meta.ownerId,
                  candidate.ownerId,
                  meta.type === 'private'
                )
              : null
          const safePlatformIdsMatch = platformIdsMatch && senderPlatformIdMappings !== null
          if (contentMatches || safePlatformIdsMatch) {
            const platformMessageIdScope = sourceHasScopedPlatformMessageIds
              ? undefined
              : getCommonPlatformMessageIdScope(orderedRows.map((row) => row.platform_message_id))
            trailingMatches.push({
              sessionId,
              ...(platformMessageIdScope ? { platformMessageIdScope } : {}),
              ...(safePlatformIdsMatch && senderPlatformIdMappings.length > 0 ? { senderPlatformIdMappings } : {}),
            })
          }
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
      const trailingMatch = trailingMatches.find((match) => match.sessionId === meta.sourceSessionId)
      return {
        decision: {
          action: 'incremental',
          sessionId: meta.sourceSessionId,
          matchedBy: 'source-session-id',
          ...(trailingMatch?.platformMessageIdScope
            ? { platformMessageIdScope: trailingMatch.platformMessageIdScope }
            : {}),
          ...(trailingMatch?.senderPlatformIdMappings
            ? { senderPlatformIdMappings: trailingMatch.senderPlatformIdMappings }
            : {}),
        },
        concurrencyKey: `session:${meta.sourceSessionId}`,
        exclusive: false,
        coalesceCreate: false,
      }
    }
    if (stableMatches.length === 1) {
      const trailingMatch = trailingMatches.find((match) => match.sessionId === stableMatches[0])
      return {
        decision: {
          action: 'incremental',
          sessionId: stableMatches[0],
          matchedBy: 'stable-id',
          ...(trailingMatch?.platformMessageIdScope
            ? { platformMessageIdScope: trailingMatch.platformMessageIdScope }
            : {}),
          ...(trailingMatch?.senderPlatformIdMappings
            ? { senderPlatformIdMappings: trailingMatch.senderPlatformIdMappings }
            : {}),
        },
        concurrencyKey: `session:${stableMatches[0]}`,
        exclusive: false,
        coalesceCreate: false,
      }
    }
  }

  // 稳定身份缺失、漂移或产生多个候选时，仍只接受唯一的 5 条连续消息重叠。
  const sourceSessionTrailingMatch = meta.sourceSessionId
    ? trailingMatches.find((match) => match.sessionId === meta.sourceSessionId)
    : undefined
  if (meta.sourceSessionId && sourceSessionTrailingMatch) {
    return {
      decision: {
        action: 'incremental',
        sessionId: meta.sourceSessionId,
        matchedBy: 'source-session-id',
        ...(sourceSessionTrailingMatch.platformMessageIdScope
          ? { platformMessageIdScope: sourceSessionTrailingMatch.platformMessageIdScope }
          : {}),
        ...(sourceSessionTrailingMatch.senderPlatformIdMappings
          ? { senderPlatformIdMappings: sourceSessionTrailingMatch.senderPlatformIdMappings }
          : {}),
      },
      concurrencyKey: `session:${meta.sourceSessionId}`,
      exclusive: false,
      coalesceCreate: false,
    }
  }
  if (trailingMatches.length === 1) {
    const [trailingMatch] = trailingMatches
    return {
      decision: {
        action: 'incremental',
        sessionId: trailingMatch.sessionId,
        matchedBy: 'trailing-messages',
        ...(trailingMatch.platformMessageIdScope
          ? { platformMessageIdScope: trailingMatch.platformMessageIdScope }
          : {}),
        ...(trailingMatch.senderPlatformIdMappings
          ? { senderPlatformIdMappings: trailingMatch.senderPlatformIdMappings }
          : {}),
      },
      concurrencyKey: `session:${trailingMatch.sessionId}`,
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
