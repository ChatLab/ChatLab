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
  for (const sessionId of [...adapter.listSessionIds()].sort()) {
    const dbPath = adapter.getDbPath(sessionId)
    parts.push(`${sessionId}:${getDbFileVersion(dbPath)}`)
  }
  return parts.join('|')
}
