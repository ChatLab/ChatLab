/**
 * Merger orchestration — abstract data-source reading, conflict checking,
 * merge assembly, and ChatLab output formatting.
 *
 * Decoupled from Electron-specific TempDbReader via MergerDataSource interface.
 */

import {
  getCollidingPlatformIds,
  getCollidingPlatformIdsFromMessages,
  normalizePlatformId,
  detectConflictsInMessages,
  mergeMergerMembers,
  type MergerMember,
  type MergerMessage,
  type ConflictCheckResult,
  type MergedMember,
  type MergedMessage,
} from '@openchatlab/core'
import { CHATLAB_FORMAT_VERSION } from '@openchatlab/shared-types'
import {
  createMessageDedupState,
  generateFallbackMessageKey,
  registerMessageAndCheckDuplicate,
} from '../import/message-deduplicator'

export interface MergerInputMessage extends MergerMessage {
  platformMessageId?: string
  replyToMessageId?: string
}

export interface ChatLabMergedMessage extends MergedMessage {
  platformMessageId?: string
  replyToMessageId?: string
}

// ==================== Data source abstraction ====================

export interface MergerSourceMeta {
  name: string
  platform: string
  type: string
  groupId?: string
  groupAvatar?: string
  ownerId?: string
}

function createMessageScope(meta: MergerSourceMeta | null, members: MergerMember[], sourceIndex: number): string {
  const platform = meta?.platform || 'unknown'
  const type = meta?.type || 'unknown'

  if (meta?.groupId) return JSON.stringify([platform, type, 'group', meta.groupId])

  // A group name and its membership can both collide or change over time. Keep
  // the source isolated until exact overlapping messages prove it is the same chat.
  if (type === 'group') return JSON.stringify([platform, type, 'source', sourceIndex])

  const memberIds = [...new Set(members.map((member) => member.platformId))].sort()
  if (memberIds.length > 0) {
    if (type === 'private') {
      if (memberIds.length >= 2) return JSON.stringify([platform, type, 'members', memberIds])
    } else {
      return JSON.stringify([platform, type, 'name-members', meta?.name || '', memberIds])
    }
  }

  // A one-sided private export does not identify the other participant. Without
  // a stable group ID or complete participant set, keep message IDs source-local.
  return JSON.stringify([platform, type, 'source', sourceIndex])
}

function createMessageBridgeFamily(meta: MergerSourceMeta | null): string | undefined {
  if (!meta || meta.groupId || (meta.type !== 'group' && meta.type !== 'private')) return undefined
  // The exact message signature proves overlap; the editable chat name must
  // not prevent two exports of the same chat from sharing a scope.
  return JSON.stringify([meta.platform || 'unknown', meta.type])
}

function createMessageIdNormalizer(
  scopes: Iterable<string>
): (id: string | undefined, scope: string) => string | undefined {
  const uniqueScopes = [...new Set(scopes)]
  const scopeIndexes = new Map(uniqueScopes.map((scope, index) => [scope, index]))
  const namespaceMessageIds = uniqueScopes.length > 1

  return (id, scope) => {
    if (!id || !namespaceMessageIds) return id
    return `__chatlab_message_scope__${scopeIndexes.get(scope) ?? 0}__${encodeURIComponent(id)}`
  }
}

interface MessageScopeContext {
  sourceIndex: number
  messageScope: string
  messageBridgeFamily?: string
}

function createMessageScopeResolver(contexts: Iterable<MessageScopeContext>): {
  addMessage: (message: MergerInputMessage, context: MessageScopeContext) => void
  complete: () => void
  resolve: (sourceIndex: number) => string
} {
  const contextBySource = new Map<number, MessageScopeContext>()
  const parents = new Map<number, number>()
  const firstSourceBySignature = new Map<string, number>()

  for (const context of contexts) {
    contextBySource.set(context.sourceIndex, context)
    parents.set(context.sourceIndex, context.sourceIndex)
  }

  const find = (sourceIndex: number): number => {
    const parent = parents.get(sourceIndex) ?? sourceIndex
    if (parent === sourceIndex) return sourceIndex
    const root = find(parent)
    parents.set(sourceIndex, root)
    return root
  }

  const union = (firstSourceIndex: number, secondSourceIndex: number): void => {
    const firstRoot = find(firstSourceIndex)
    const secondRoot = find(secondSourceIndex)
    if (firstRoot === secondRoot) return

    const root = Math.min(firstRoot, secondRoot)
    parents.set(firstRoot === root ? secondRoot : firstRoot, root)
  }

  return {
    addMessage(message, context) {
      if (!context.messageBridgeFamily || !message.platformMessageId) return

      const fallbackKey = generateFallbackMessageKey({
        timestamp: message.timestamp,
        senderPlatformId: message.senderPlatformId,
        type: message.type,
        content: message.content ?? null,
        replyToMessageId: message.replyToMessageId,
      })
      const signature = JSON.stringify([context.messageBridgeFamily, message.platformMessageId, fallbackKey])
      const firstSourceIndex = firstSourceBySignature.get(signature)
      if (firstSourceIndex === undefined) {
        firstSourceBySignature.set(signature, context.sourceIndex)
        return
      }
      union(firstSourceIndex, context.sourceIndex)
    },
    complete() {
      firstSourceBySignature.clear()
    },
    resolve(sourceIndex) {
      const rootContext = contextBySource.get(find(sourceIndex))
      return rootContext?.messageScope ?? JSON.stringify(['unknown', 'source', sourceIndex])
    },
  }
}

/**
 * Abstract data source for merger input.
 * In Electron, this wraps TempDbReader. Other platforms can implement
 * their own (e.g. reading from IndexedDB, REST API, etc.).
 */
export interface MergerDataSource {
  getMeta(): MergerSourceMeta | null
  getMembers(): MergerMember[]
  getMessageCount(): number
  streamMessages(batchSize: number, callback: (messages: MergerInputMessage[]) => void): void
}

// ==================== Output types ====================

export interface MergeSourceInfo {
  filename: string
  platform: string
  messageCount: number
}

export interface ChatLabHeader {
  version: typeof CHATLAB_FORMAT_VERSION
  exportedAt: number
  generator: string
  description: string
}

export interface ChatLabMeta {
  name: string
  platform: string
  type: string
  sources: MergeSourceInfo[]
  groupId?: string
  groupAvatar?: string
  ownerId?: string
}

export interface ChatLabOutput {
  chatlab: ChatLabHeader
  meta: ChatLabMeta
  members: MergedMember[]
  messages: ChatLabMergedMessage[]
}

// ==================== Conflict checking ====================

export function checkConflictsFromSources(
  dataSources: Array<{ source: MergerDataSource; filename: string }>
): ConflictCheckResult {
  const preparedSources = dataSources.map(({ source, filename }, sourceIndex) => {
    const meta = source.getMeta()
    const members = source.getMembers()
    return {
      source,
      filename,
      sourceIndex,
      platform: meta?.platform || 'unknown',
      messageScope: createMessageScope(meta, members, sourceIndex),
      messageBridgeFamily: createMessageBridgeFamily(meta),
    }
  })
  const allMessages: Array<{
    msg: MergerInputMessage
    source: string
    sourceIndex: number
    platform: string
    messageScope: string
    messageBridgeFamily?: string
  }> = []

  for (const { source, filename, sourceIndex, platform, messageScope, messageBridgeFamily } of preparedSources) {
    source.streamMessages(10000, (messages) => {
      for (const msg of messages) {
        allMessages.push({ msg, source: filename, sourceIndex, platform, messageScope, messageBridgeFamily })
      }
    })
  }

  const result = detectConflictsInMessages(allMessages)
  const collidingIds = getCollidingPlatformIdsFromMessages(allMessages)
  const scopeResolver = createMessageScopeResolver(preparedSources)
  for (const message of allMessages) scopeResolver.addMessage(message.msg, message)
  scopeResolver.complete()
  const normalizeMessageId = createMessageIdNormalizer(
    preparedSources.map(({ sourceIndex }) => scopeResolver.resolve(sourceIndex))
  )
  const dedupState = createMessageDedupState()
  let totalMessages = 0

  for (const { msg, sourceIndex, platform } of allMessages) {
    const messageScope = scopeResolver.resolve(sourceIndex)
    const senderPlatformId = normalizePlatformId(msg.senderPlatformId, platform, collidingIds)
    const duplicate = registerMessageAndCheckDuplicate(
      {
        platformMessageId: normalizeMessageId(msg.platformMessageId, messageScope),
        timestamp: msg.timestamp,
        senderPlatformId,
        type: msg.type,
        content: msg.content ?? null,
        replyToMessageId: normalizeMessageId(msg.replyToMessageId, messageScope),
      },
      dedupState
    )
    if (!duplicate) totalMessages++
  }

  return { ...result, totalMessages }
}

// ==================== Merge orchestration ====================

export interface MergeOrchestrationResult {
  success: true
  chatLabData: ChatLabOutput
}

/**
 * Build a merged ChatLabOutput from multiple data sources.
 * Pure orchestration: reads data sources, calls core algorithms,
 * assembles the output. Does NOT write to disk or import to DB.
 */
export function buildMergedOutput(
  dataSources: Array<{ source: MergerDataSource; filename: string }>,
  outputName: string
): MergeOrchestrationResult {
  const metas = dataSources.map(({ source, filename }, sourceIndex) => {
    const meta = source.getMeta()
    const members = source.getMembers()
    return {
      meta,
      members,
      filename,
      source,
      sourceIndex,
      messageScope: createMessageScope(meta, members, sourceIndex),
      messageBridgeFamily: createMessageBridgeFamily(meta),
    }
  })

  const collidingIds = getCollidingPlatformIds(
    metas.map(({ meta, members }) => ({
      platform: meta?.platform || 'unknown',
      members: members.map((m) => ({ platformId: m.platformId })),
    }))
  )

  const memberMap = mergeMergerMembers(
    metas.map(({ meta, members }) => ({
      platform: meta?.platform || 'unknown',
      members,
    })),
    collidingIds
  )

  const uniquePlatforms = [...new Set(metas.map(({ meta }) => meta?.platform || 'unknown'))]
  const scopeResolver = createMessageScopeResolver(metas)
  for (const context of metas) {
    if (!context.messageBridgeFamily) continue
    context.source.streamMessages(10000, (messages) => {
      for (const message of messages) scopeResolver.addMessage(message, context)
    })
  }
  scopeResolver.complete()
  const normalizeMessageId = createMessageIdNormalizer(
    metas.map(({ sourceIndex }) => scopeResolver.resolve(sourceIndex))
  )

  // Streaming dedup: prefer stable platform message IDs and use the content
  // fingerprint only for messages that do not have one.
  const dedupState = createMessageDedupState()
  const fallbackOnlyMessageIndexes = new Map<string, number>()
  const mergedMessages: ChatLabMergedMessage[] = []

  for (const { source, meta, sourceIndex } of metas) {
    const platform = meta?.platform || 'unknown'
    const messageScope = scopeResolver.resolve(sourceIndex)
    source.streamMessages(10000, (messages) => {
      for (const msg of messages) {
        const nid = normalizePlatformId(msg.senderPlatformId, platform, collidingIds)
        const platformMessageId = normalizeMessageId(msg.platformMessageId, messageScope)
        const replyToMessageId = normalizeMessageId(msg.replyToMessageId, messageScope)
        const dedupMessage = {
          platformMessageId,
          timestamp: msg.timestamp,
          senderPlatformId: nid,
          type: msg.type,
          content: msg.content ?? null,
          replyToMessageId,
        }
        const fallbackKey = generateFallbackMessageKey(dedupMessage)
        const shouldBackfillId = Boolean(
          platformMessageId &&
          !dedupState.platformMessageIds.has(platformMessageId) &&
          dedupState.fallbackOnlyKeys.has(fallbackKey)
        )

        if (registerMessageAndCheckDuplicate(dedupMessage, dedupState)) {
          if (shouldBackfillId) {
            const retainedIndex = fallbackOnlyMessageIndexes.get(fallbackKey)
            if (retainedIndex !== undefined) {
              mergedMessages[retainedIndex].platformMessageId = platformMessageId
              fallbackOnlyMessageIndexes.delete(fallbackKey)
            }
          }
          continue
        }

        const retainedIndex = mergedMessages.length
        mergedMessages.push({
          platformMessageId,
          sender: nid,
          accountName: msg.senderAccountName,
          groupNickname: msg.senderGroupNickname,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
          replyToMessageId,
        })
        if (!platformMessageId) fallbackOnlyMessageIndexes.set(fallbackKey, retainedIndex)
      }
    })
  }

  mergedMessages.sort((a, b) => a.timestamp - b.timestamp)

  const sources: MergeSourceInfo[] = dataSources.map(({ source, filename }) => ({
    filename,
    platform: source.getMeta()?.platform || 'unknown',
    messageCount: source.getMessageCount(),
  }))

  const platform = uniquePlatforms.length === 1 ? uniquePlatforms[0] : 'mixed'

  const groupIds = new Set(metas.map(({ meta }) => meta?.groupId).filter(Boolean))
  const groupId = groupIds.size === 1 ? metas.find(({ meta }) => meta?.groupId)?.meta?.groupId : undefined
  const groupAvatar = groupId
    ? metas.filter(({ meta }) => meta?.groupId === groupId).pop()?.meta?.groupAvatar
    : undefined
  const ownerIds = new Set(metas.map(({ meta }) => meta?.ownerId).filter((id): id is string => Boolean(id)))
  const ownerCandidate = uniquePlatforms.length === 1 && ownerIds.size === 1 ? [...ownerIds][0] : undefined
  const ownerId = ownerCandidate && memberMap.has(ownerCandidate) ? ownerCandidate : undefined

  const chatLabData: ChatLabOutput = {
    chatlab: {
      version: CHATLAB_FORMAT_VERSION,
      exportedAt: Math.floor(Date.now() / 1000),
      generator: 'ChatLab Merge Tool',
      description: `Merged from ${dataSources.length} files`,
    },
    meta: {
      name: outputName,
      platform,
      type: metas[0]?.meta?.type || 'group',
      sources,
      groupId,
      groupAvatar,
      ownerId,
    },
    members: Array.from(memberMap.values()),
    messages: mergedMessages,
  }

  return { success: true, chatLabData }
}

// ==================== JSONL serialization ====================

/**
 * Serialize ChatLabOutput to JSONL lines (generator for streaming writes).
 */
export function* serializeChatLabToJsonl(data: ChatLabOutput): Generator<string> {
  yield JSON.stringify({
    _type: 'header',
    chatlab: data.chatlab,
    meta: data.meta,
  })

  for (const member of data.members) {
    yield JSON.stringify({ _type: 'member', ...member })
  }

  for (const msg of data.messages) {
    yield JSON.stringify({ _type: 'message', ...msg })
  }
}
