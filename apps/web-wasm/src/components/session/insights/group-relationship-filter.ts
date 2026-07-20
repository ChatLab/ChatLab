import type { TimeFilter } from '@openchatlab/shared-types'

export function getProximityTimeFilter(filter?: TimeFilter): TimeFilter | undefined {
  if (!filter) return undefined

  const timeFilter: TimeFilter = {}
  if (filter.startTs !== undefined) timeFilter.startTs = filter.startTs
  if (filter.endTs !== undefined) timeFilter.endTs = filter.endTs

  return timeFilter.startTs === undefined && timeFilter.endTs === undefined ? undefined : timeFilter
}
