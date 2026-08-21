import { getSessionMeta } from '@openchatlab/core'
import type { CrossChatMessageSource } from '@openchatlab/shared-types'
import type { PreprocessConfig } from '../../ai/preprocessor'
import { preprocessMessages } from '../../ai/preprocessor'
import type { SessionRuntimeAdapter } from '../adapters'

/**
 * Apply message cleaning per source session before cross-chat evidence reaches an LLM.
 * Session-qualified pseudonyms prevent unrelated local member IDs from being conflated across databases.
 */
export function preprocessCrossChatMessages(
  adapter: SessionRuntimeAdapter,
  sessionId: string,
  messages: CrossChatMessageSource[],
  config?: PreprocessConfig
): CrossChatMessageSource[] {
  const safeConfig = config ? { ...config, mergeConsecutive: false, anonymizeNames: false } : undefined
  const processed = preprocessMessages(
    messages.map((message) => ({ ...message })),
    safeConfig
  )
  if (!config?.anonymizeNames) return processed

  let ownerPlatformId: string | null = null
  try {
    const db = adapter.openReadonly(sessionId)
    ownerPlatformId = db ? getSessionMeta(db)?.ownerId?.trim() || null : null
  } catch {
    // Anonymization remains safe without owner labeling.
  }

  return processed.map((message) => ({
    ...message,
    senderName:
      ownerPlatformId && message.senderPlatformId === ownerPlatformId ? 'Owner' : `U${message.senderId}@${sessionId}`,
  }))
}
