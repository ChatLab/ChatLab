/**
 * Shared import writer helpers.
 *
 * Functions here operate on DatabaseAdapter and can be used by any
 * environment that wraps its DB connection accordingly.
 */

import type { DatabaseAdapter } from '../interfaces'

/**
 * Build a Map from member platform_id → internal row id.
 * Used after bulk member insert to resolve sender_id for messages.
 */
export function buildMemberIdMap(db: DatabaseAdapter): Map<string, number> {
  const rows = db.prepare('SELECT id, platform_id FROM member').all() as Array<{ id: number; platform_id: string }>
  const map = new Map<string, number>()
  for (const row of rows) {
    map.set(row.platform_id, row.id)
  }
  return map
}
