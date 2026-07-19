/**
 * Merger orchestration — abstract data-source reading, conflict checking,
 * merge assembly, and ChatLab output formatting.
 *
 * Decoupled from Electron-specific TempDbReader via MergerDataSource interface.
 */

import {
  getCollidingPlatformIds,
  normalizePlatformId,
  detectConflictsInMessages,
  mergeMergerMembers,
  generateMessageKey,
  type MergerMember,
  type MergerMessage,
  type ConflictCheckResult,
  type MergedMember,
  type MergedMessage,
} from '@openchatlab/core'
import { CHATLAB_FORMAT_VERSION } from '@openchatlab/shared-types'

// ==================== Data source abstraction ====================

export interface MergerSourceMeta {
  name: string
  platform: string
  type: string
  groupId?: string
  groupAvatar?: string
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
  streamMessages(batchSize: number, callback: (messages: MergerMessage[]) => void): void
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
}

export interface ChatLabOutput {
  chatlab: ChatLabHeader
  meta: ChatLabMeta
  members: MergedMember[]
  messages: MergedMessage[]
}

// ==================== Conflict checking ====================

export function checkConflictsFromSources(
  dataSources: Array<{ source: MergerDataSource; filename: string }>
): ConflictCheckResult {
  const allMessages: Array<{ msg: MergerMessage; source: string; platform: string }> = []

  for (const { source, filename } of dataSources) {
    const meta = source.getMeta()
    const platform = meta?.platform || 'unknown'
    source.streamMessages(10000, (messages) => {
      for (const msg of messages) {
        allMessages.push({ msg, source: filename, platform })
      }
    })
  }

  return detectConflictsInMessages(allMessages)
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
  const metas = dataSources.map(({ source, filename }) => ({
    meta: source.getMeta(),
    members: source.getMembers(),
    filename,
    source,
  }))

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

  // Streaming dedup: process batches to avoid loading all into memory
  const seenKeys = new Set<string>()
  const mergedMessages: MergedMessage[] = []

  for (const { source, meta } of metas) {
    const platform = meta?.platform || 'unknown'
    source.streamMessages(10000, (messages) => {
      for (const msg of messages) {
        const nid = normalizePlatformId(msg.senderPlatformId, platform, collidingIds)
        const key = generateMessageKey(msg.timestamp, nid, msg.content ?? null)
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        mergedMessages.push({
          sender: nid,
          accountName: msg.senderAccountName,
          groupNickname: msg.senderGroupNickname,
          timestamp: msg.timestamp,
          type: msg.type,
          content: msg.content,
        })
      }
    })
  }

  mergedMessages.sort((a, b) => a.timestamp - b.timestamp)

  const sources: MergeSourceInfo[] = dataSources.map(({ source, filename }) => ({
    filename,
    platform: source.getMeta()?.platform || 'unknown',
    messageCount: source.getMessageCount(),
  }))

  const uniquePlatforms = [...new Set(metas.map(({ meta }) => meta?.platform || 'unknown'))]
  const platform = uniquePlatforms.length === 1 ? uniquePlatforms[0] : 'mixed'

  const groupIds = new Set(metas.map(({ meta }) => meta?.groupId).filter(Boolean))
  const groupId = groupIds.size === 1 ? metas.find(({ meta }) => meta?.groupId)?.meta?.groupId : undefined
  const groupAvatar = groupId
    ? metas.filter(({ meta }) => meta?.groupId === groupId).pop()?.meta?.groupAvatar
    : undefined

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
