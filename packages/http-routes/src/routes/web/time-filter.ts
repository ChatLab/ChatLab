/**
 * Time-filter query parsing for Web analytics routes.
 */

import type { TimeFilter } from '@openchatlab/shared-types'

export function parseTimeFilter(query: Record<string, string | undefined>): TimeFilter | undefined {
  const { startTs, endTs, memberId } = query
  if (!startTs && !endTs && !memberId) return undefined
  const filter: TimeFilter = {}
  if (startTs) filter.startTs = parseInt(startTs, 10)
  if (endTs) filter.endTs = parseInt(endTs, 10)
  if (memberId) filter.memberId = parseInt(memberId, 10)
  return filter
}
