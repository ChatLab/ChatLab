/**
 * 高级分析模块入口
 * 所有查询逻辑委托给 @openchatlab/core
 */

export { getCatchphraseAnalysis } from './repeat'

export {
  getMentionAnalysis,
  getMentionGraph,
  getGroupRelationshipGalaxy,
  getLaughAnalysis,
  getClusterGraph,
} from './social'
export type {
  MentionGraphData,
  MentionGraphNode,
  MentionGraphLink,
  ClusterGraphData,
  ClusterGraphNode,
  ClusterGraphLink,
  ClusterGraphOptions,
} from './social'

export { getLanguagePreferenceAnalysis } from './languagePreference'

export { getRelationshipStats } from './relationship'
export type {
  RelationshipStats,
  RelationshipMonthStats,
  IceBreakerItem,
  ResponseLatencyMember,
  PerseveranceMember,
} from './relationship'
