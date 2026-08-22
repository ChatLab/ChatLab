import { getDbFileVersion } from '../../cache/analytics-cache'
import type { SessionRuntimeAdapter } from '../adapters'
import { CONTACTS_ALGORITHM_VERSION } from './compute'
import { normalizeContactsTimeRangePreset } from './time-range'
import type { ContactsTimeRangePreset } from '@openchatlab/shared-types'

export function buildContactsSignature(
  adapter: SessionRuntimeAdapter,
  timeRangePreset?: ContactsTimeRangePreset
): string {
  const parts = [
    `algorithm:${CONTACTS_ALGORITHM_VERSION}`,
    `range:${normalizeContactsTimeRangePreset(timeRangePreset)}`,
  ]
  const sessionIds = adapter.listSessionCandidateIds?.() ?? adapter.listSessionIds()
  for (const sessionId of [...sessionIds].sort()) {
    const dbPath = adapter.getDbPath(sessionId)
    parts.push(`${sessionId}:${getDbFileVersion(dbPath)}`)
  }
  return parts.join('|')
}
