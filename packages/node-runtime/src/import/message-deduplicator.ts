import { generateMessageKey } from '@openchatlab/core'

export interface MessageDedupState {
  platformMessageIds: Set<string>
  /** Fallback keys for every accepted message, regardless of platform ID. */
  fallbackKeys: Set<string>
  /** Unmatched fallback keys whose accepted message did not have a stable platform ID. */
  fallbackOnlyKeys: Set<string>
}

export interface DedupMessage {
  platformMessageId?: string
  timestamp: number
  senderPlatformId: string
  type: number
  content: string | null
  replyToMessageId?: string
}

export function generateFallbackMessageKey(message: Omit<DedupMessage, 'platformMessageId'>): string {
  const contentKey = generateMessageKey(message.timestamp, message.senderPlatformId, message.content)
  return JSON.stringify([contentKey, message.type, message.replyToMessageId || null])
}

export function createMessageDedupState(
  platformMessageIds: Iterable<string> = [],
  fallbackKeys: Iterable<string> = [],
  fallbackOnlyKeys: Iterable<string> = []
): MessageDedupState {
  return {
    platformMessageIds: new Set(platformMessageIds),
    fallbackKeys: new Set(fallbackKeys),
    fallbackOnlyKeys: new Set(fallbackOnlyKeys),
  }
}

/**
 * Canonical file-import dedup rule: prefer stable platform message IDs and
 * fall back to timestamp + sender platform ID + type + normalized content + reply target.
 */
export function registerMessageAndCheckDuplicate(message: DedupMessage, state: MessageDedupState): boolean {
  const key = generateFallbackMessageKey(message)

  if (message.platformMessageId) {
    if (state.platformMessageIds.has(message.platformMessageId)) return true
    state.platformMessageIds.add(message.platformMessageId)

    // Only bridge ID-bearing messages to fallback-only copies. Comparing this
    // key against other ID-bearing messages would incorrectly merge distinct
    // platform messages that happen to have identical content and timestamps.
    if (state.fallbackOnlyKeys.delete(key)) return true
    state.fallbackKeys.add(key)
    return false
  }

  if (state.fallbackKeys.has(key)) return true
  state.fallbackKeys.add(key)
  state.fallbackOnlyKeys.add(key)
  return false
}
