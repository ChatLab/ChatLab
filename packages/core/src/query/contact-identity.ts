import type { ChatPlatform } from '@openchatlab/shared-types'
import { isNameMatchPlatform } from '../owner'
import type { ContactMemberRef } from './contact-queries'

export function shouldScopeContactToSession(platform: ChatPlatform, contact: ContactMemberRef): boolean {
  if (isNameMatchPlatform(platform)) return true
  return platform.trim().toLowerCase() === 'qq' && contact.platformId.trim() === contact.name.trim()
}

export function buildContactKey(platform: ChatPlatform, platformId: string, sessionId?: string): string {
  const normalizedPlatform = platform.trim()
  const normalizedPlatformId = platformId.trim()
  if (!normalizedPlatform) throw new Error('platform is required')
  if (!normalizedPlatformId) throw new Error('platformId is required')
  return sessionId?.trim()
    ? `${normalizedPlatform}:${sessionId.trim()}:${normalizedPlatformId}`
    : `${normalizedPlatform}:${normalizedPlatformId}`
}
