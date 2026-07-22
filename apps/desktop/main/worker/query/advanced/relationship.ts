/**
 * 关系分析模块（委托给 @openchatlab/core）
 */

import { openDatabaseAdapter, type TimeFilter } from '../../core'
import { getRelationshipStats as coreGetRelationshipStats } from '@openchatlab/core'
import type {
  RelationshipStats,
  RelationshipMonthStats,
  IceBreakerItem,
  ResponseLatencyMember,
  PerseveranceMember,
  RelationshipOptions,
} from '@openchatlab/core'

export type { RelationshipStats, RelationshipMonthStats, IceBreakerItem, ResponseLatencyMember, PerseveranceMember }

export function getRelationshipStats(
  sessionId: string,
  filter?: TimeFilter,
  options?: RelationshipOptions
): RelationshipStats {
  const db = openDatabaseAdapter(sessionId)
  if (!db) {
    return {
      months: [],
      members: [],
      totalSessions: 0,
      hasSessionIndex: false,
      iceBreakers: [],
      responseLatency: [],
      perseverance: [],
      monthlyResponseLatency: [],
      monthlyPerseverance: [],
    }
  }
  return coreGetRelationshipStats(db, filter, options)
}
