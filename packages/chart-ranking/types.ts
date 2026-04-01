/**
 * chart-ranking 插件类型定义
 * 从 @/types/analysis 提取的榜单相关类型
 */

// ==================== 基础类型 ====================

export interface MemberActivity {
  memberId: number
  platformId: string
  name: string
  messageCount: number
  percentage: number
  avatar?: string | null
}

// ==================== 夜猫分析 ====================

export type NightOwlTitle = '养生达人' | '偶尔失眠' | '经常失眠' | '夜猫子' | '秃头预备役' | '修仙练习生' | '守夜冠军'

export interface NightOwlRankItem {
  memberId: number
  platformId: string
  name: string
  totalNightMessages: number
  title: NightOwlTitle
  hourlyBreakdown: {
    h23: number
    h0: number
    h1: number
    h2: number
    h3to4: number
  }
  percentage: number
}

export interface TimeRankItem {
  memberId: number
  platformId: string
  name: string
  count: number
  avgTime: string
  extremeTime: string
  percentage: number
}

export interface ConsecutiveNightRecord {
  memberId: number
  platformId: string
  name: string
  maxConsecutiveDays: number
  currentStreak: number
}

export interface NightOwlChampion {
  memberId: number
  platformId: string
  name: string
  score: number
  nightMessages: number
  lastSpeakerCount: number
  consecutiveDays: number
}

export interface NightOwlAnalysis {
  nightOwlRank: NightOwlRankItem[]
  lastSpeakerRank: TimeRankItem[]
  firstSpeakerRank: TimeRankItem[]
  consecutiveRecords: ConsecutiveNightRecord[]
  champions: NightOwlChampion[]
  totalDays: number
}

// ==================== 龙王分析 ====================

export interface DragonKingRankItem {
  memberId: number
  platformId: string
  name: string
  count: number
  percentage: number
}

export interface DragonKingAnalysis {
  rank: DragonKingRankItem[]
  totalDays: number
}

// ==================== 潜水分析 ====================

export interface DivingRankItem {
  memberId: number
  platformId: string
  name: string
  lastMessageTs: number
  daysSinceLastMessage: number
}

export interface DivingAnalysis {
  rank: DivingRankItem[]
}

// ==================== 复读分析 ====================

export interface RepeatStatItem {
  memberId: number
  platformId: string
  name: string
  count: number
  percentage: number
}

export interface RepeatRateItem {
  memberId: number
  platformId: string
  name: string
  count: number
  totalMessages: number
  rate: number
}

export interface ChainLengthDistribution {
  length: number
  count: number
}

export interface HotRepeatContent {
  content: string
  count: number
  maxChainLength: number
  originatorName: string
  lastTs: number
  firstMessageId: number
}

export interface FastestRepeaterItem {
  memberId: number
  platformId: string
  name: string
  count: number
  avgTimeDiff: number
}

export interface RepeatAnalysis {
  originators: RepeatStatItem[]
  initiators: RepeatStatItem[]
  breakers: RepeatStatItem[]
  fastestRepeaters: FastestRepeaterItem[]
  originatorRates: RepeatRateItem[]
  initiatorRates: RepeatRateItem[]
  breakerRates: RepeatRateItem[]
  chainLengthDistribution: ChainLengthDistribution[]
  hotContents: HotRepeatContent[]
  avgChainLength: number
  totalRepeatChains: number
}

// ==================== 斗图分析 ====================

export interface MemeBattleRankItem {
  memberId: number
  platformId: string
  name: string
  count: number
  percentage: number
}

export interface MemeBattleRecord {
  startTime: number
  endTime: number
  totalImages: number
  participantCount: number
  participants: Array<{
    memberId: number
    name: string
    imageCount: number
  }>
}

export interface MemeBattleAnalysis {
  topBattles: MemeBattleRecord[]
  rankByCount: MemeBattleRankItem[]
  rankByImageCount: MemeBattleRankItem[]
  totalBattles: number
}

// ==================== 打卡分析 ====================

export interface StreakRankItem {
  memberId: number
  name: string
  maxStreak: number
  maxStreakStart: string
  maxStreakEnd: string
  currentStreak: number
}

export interface LoyaltyRankItem {
  memberId: number
  name: string
  totalDays: number
  percentage: number
}

export interface CheckInAnalysis {
  streakRank: StreakRankItem[]
  loyaltyRank: LoyaltyRankItem[]
  totalDays: number
}
