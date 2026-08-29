import type { ContactsTimeRangePreset } from '@openchatlab/shared-types'
import { getDbFileVersion } from '../../../cache/analytics-cache'
import type { SessionRuntimeAdapter } from '../../adapters'
import { PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION } from './compute'
import { normalizePeopleRelationshipsTimeRangePreset } from './time-range'

export function buildPeopleRelationshipsSignature(
  adapter: SessionRuntimeAdapter,
  timeRangePreset?: ContactsTimeRangePreset
): string {
  const parts = [
    `algorithm:${PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION}`,
    `range:${normalizePeopleRelationshipsTimeRangePreset(timeRangePreset)}`,
  ]
  const sessionIds = adapter.listSessionCandidateIds?.() ?? adapter.listSessionIds()
  for (const sessionId of [...sessionIds].sort()) {
    const dbPath = adapter.getDbPath(sessionId)
    parts.push(`${sessionId}:${getDbFileVersion(dbPath)}`)
  }
  return parts.join('|')
}
