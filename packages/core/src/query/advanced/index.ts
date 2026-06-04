/**
 * 高级分析模块入口（平台无关）
 *
 * 所有函数接收 DatabaseAdapter 参数，不依赖全局状态或特定运行时。
 */

export { getCatchphraseAnalysis } from './repeat'
export type { CatchphraseAnalysis, MemberCatchphrase, CatchphraseItem } from './repeat'
export { isHumanCatchphraseContent, NON_HUMAN_CATCHPHRASE_PLACEHOLDERS } from './catchphrase-filter'

export { getMentionAnalysis, getMentionGraph, getLaughAnalysis, getClusterGraph } from './social'
export type {
  MentionGraphData,
  MentionGraphNode,
  MentionGraphLink,
  ClusterGraphData,
  ClusterGraphNode,
  ClusterGraphLink,
  ClusterGraphOptions,
} from './social'

export { getRelationshipStats } from './relationship'
export type {
  RelationshipStats,
  RelationshipMonthStats,
  IceBreakerItem,
  ResponseLatencyMember,
  PerseveranceMember,
  MonthlyResponseLatency,
  MonthlyPerseverance,
  RelationshipOptions,
} from './relationship'

export { getLanguagePreferenceAnalysis } from './languagePreference'
export type { NlpProvider, PosTagResult, LanguagePreferenceParams } from './languagePreference'
