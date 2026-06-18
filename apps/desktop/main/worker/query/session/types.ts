/**
 * Session module type definitions.
 * Core types (ChatSessionItem, DEFAULT_SESSION_GAP_THRESHOLD) are re-exported
 * from @openchatlab/core; Electron-only types remain here.
 */

export { DEFAULT_SESSION_GAP_THRESHOLD } from '@openchatlab/core'
export type { ChatSessionItem, SessionIndexStats } from '@openchatlab/core'

// AI tool types — re-exported from core via aiTools.ts
export type { SessionMessagesResult } from './aiTools'
