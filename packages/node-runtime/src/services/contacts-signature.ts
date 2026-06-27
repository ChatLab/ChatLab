import { getDbFileVersion } from '../cache/analytics-cache'
import type { SessionRuntimeAdapter } from './adapters'
import { CONTACTS_ALGORITHM_VERSION } from './contacts-compute'

export function buildContactsSignature(adapter: SessionRuntimeAdapter): string {
  const parts = [`algorithm:${CONTACTS_ALGORITHM_VERSION}`]
  for (const sessionId of [...adapter.listSessionIds()].sort()) {
    const dbPath = adapter.getDbPath(sessionId)
    parts.push(`${sessionId}:${getDbFileVersion(dbPath)}`)
  }
  return parts.join('|')
}
