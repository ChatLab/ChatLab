/**
 * 社交分析模块（委托给 @openchatlab/core）
 */

import { openDatabaseAdapter, type TimeFilter } from '../../core'
import {
  getMentionAnalysis as coreGetMentionAnalysis,
  getMentionGraph as coreGetMentionGraph,
  getLaughAnalysis as coreGetLaughAnalysis,
  getClusterGraph as coreGetClusterGraph,
} from '@openchatlab/core'
import type {
  MentionGraphData,
  MentionGraphNode,
  MentionGraphLink,
  ClusterGraphData,
  ClusterGraphNode,
  ClusterGraphLink,
  ClusterGraphOptions,
} from '@openchatlab/core'

export type {
  MentionGraphData,
  MentionGraphNode,
  MentionGraphLink,
  ClusterGraphData,
  ClusterGraphNode,
  ClusterGraphLink,
  ClusterGraphOptions,
}

export function getMentionAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return { topMentioners: [], topMentioned: [], totalMentions: 0 }
  return coreGetMentionAnalysis(db, filter)
}

export function getMentionGraph(sessionId: string, filter?: TimeFilter): MentionGraphData {
  const db = openDatabaseAdapter(sessionId)
  if (!db) return { nodes: [], links: [], maxLinkValue: 0 }
  return coreGetMentionGraph(db, filter)
}

export function getLaughAnalysis(sessionId: string, filter?: TimeFilter, keywords?: string[]): any {
  const db = openDatabaseAdapter(sessionId)
  if (!db)
    return {
      rankByRate: [],
      rankByCount: [],
      typeDistribution: [],
      totalLaughs: 0,
      totalMessages: 0,
      groupLaughRate: 0,
    }
  return coreGetLaughAnalysis(db, filter, keywords)
}

export function getClusterGraph(
  sessionId: string,
  filter?: TimeFilter,
  options?: ClusterGraphOptions
): ClusterGraphData {
  const db = openDatabaseAdapter(sessionId)
  if (!db) {
    return {
      nodes: [],
      links: [],
      maxLinkValue: 0,
      communities: [],
      stats: { totalMembers: 0, totalMessages: 0, involvedMembers: 0, edgeCount: 0, communityCount: 0 },
    }
  }
  return coreGetClusterGraph(db, filter, options)
}
