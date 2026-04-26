import type { RemoteSession } from '@/stores/apiServer'

export type SessionTypeSelection = 'private' | 'group' | 'other'

export function getSessionTypeSelection(session: RemoteSession): SessionTypeSelection {
  const rawType = String(session.type || '')
    .trim()
    .toLowerCase()
  const id = String(session.id || '')
    .trim()
    .toLowerCase()

  if (rawType === 'group' || id.endsWith('@chatroom')) return 'group'
  if (rawType === 'private') return 'private'

  if (
    rawType === 'channel' ||
    rawType === 'official' ||
    rawType === 'other' ||
    id.startsWith('gh_') ||
    id.includes('@openim') ||
    (id.startsWith('weixin') && id !== 'weixin')
  ) {
    return 'other'
  }

  return 'other'
}
