/**
 * 高级分析模块入口（平台无关）
 *
 * 所有函数接收 DatabaseAdapter 参数，不依赖全局状态或特定运行时。
 */

export { getCatchphraseAnalysis } from './repeat'
export type { CatchphraseAnalysis, MemberCatchphrase, CatchphraseItem } from './repeat'

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

export { getJourneyStats } from './journey'
export type {
  JourneyStats,
  JourneyRange,
  JourneyMonth,
  JourneyYear,
  JourneyMember,
  JourneySegment,
  JourneySilence,
} from './journey'

export { getDuoProfileStats } from './duo-profile'
export type { DuoProfileStats, DuoProfileMember, DuoProfileUnavailableReason } from './duo-profile'

export { getLanguagePreferenceAnalysis } from './languagePreference'
export type { NlpProvider, PosTagResult, LanguagePreferenceParams } from './languagePreference'

export {
  getDragonKingAnalysis,
  getDivingAnalysis,
  getCheckInAnalysis,
  getMemeBattleAnalysis,
  getNightOwlAnalysis,
  getRepeatAnalysis,
} from './ranking'
export type {
  NightOwlTitle,
  NightOwlRankItem,
  TimeRankItem,
  ConsecutiveNightRecord,
  NightOwlChampion,
  NightOwlAnalysis,
  DragonKingRankItem,
  DragonKingAnalysis,
  DivingRankItem,
  DivingAnalysis,
  RepeatStatItem,
  RepeatRateItem,
  ChainLengthDistribution,
  HotRepeatContent,
  FastestRepeaterItem,
  RepeatAnalysis,
  MemeBattleRankItem,
  MemeBattleRecord,
  MemeBattleAnalysis,
  StreakRankItem,
  LoyaltyRankItem,
  CheckInAnalysis,
} from './ranking'
