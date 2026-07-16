/**
 * ChatLab 分析结果类型定义
 * 包含：各类榜单分析、统计结果
 */

// ==================== 基础分析类型 ====================

/**
 * 成员活跃度统计
 */
export interface MemberActivity {
  memberId: number
  platformId: string
  name: string
  messageCount: number
  percentage: number // 占总消息的百分比
  avatar?: string | null // 成员头像（base64 Data URL）
}

/**
 * 成员信息（含统计数据和别名，用于成员管理）
 */
export interface MemberWithStats {
  id: number
  platformId: string
  accountName: string | null // 账号名称
  groupNickname: string | null // 群昵称
  aliases: string[] // 用户自定义别名
  messageCount: number
  lastMessageTs: number | null // 最后发言时间（Unix 秒级时间戳）
  avatar: string | null // 头像（base64 Data URL）
}

/**
 * 时段活跃度统计
 */
export interface HourlyActivity {
  hour: number // 0-23
  messageCount: number
}

/**
 * 日期活跃度统计
 */
export interface DailyActivity {
  date: string // YYYY-MM-DD
  messageCount: number
}

/**
 * 星期活跃度统计
 */
export interface WeekdayActivity {
  weekday: number // 1-7，1=周一，7=周日
  messageCount: number
}

/**
 * 月份活跃度统计
 */
export interface MonthlyActivity {
  month: number // 1-12
  messageCount: number
}

/**
 * 成员历史昵称记录
 */
export interface MemberNameHistory {
  nameType: 'account_name' | 'group_nickname' // 名称类型
  name: string // 昵称
  startTs: number // 开始使用时间戳（秒）
  endTs: number | null // 停止使用时间戳（秒），null 表示当前昵称
}

/**
 * 成员口头禅项
 */
export interface MemberCatchphrase {
  memberId: number
  platformId: string
  name: string
  catchphrases: Array<{
    content: string
    count: number
  }>
}

/**
 * 口头禅分析结果
 */
export interface CatchphraseAnalysis {
  members: MemberCatchphrase[]
}

// ==================== @ 互动分析类型 ====================

/**
 * @ 排行榜项
 */
export interface MentionRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // @ 次数
  percentage: number // 占比
}

/**
 * @ 关系对（谁 @ 谁）
 */
export interface MentionPair {
  fromMemberId: number
  fromName: string
  toMemberId: number
  toName: string
  count: number // @ 次数
}

/**
 * 单向关注
 */
export interface OneWayMention {
  fromMemberId: number
  fromName: string
  toMemberId: number
  toName: string
  fromToCount: number // A @ B 的次数
  toFromCount: number // B @ A 的次数
  ratio: number // 单向比例 (fromToCount / (fromToCount + toFromCount))
}

/**
 * 双向奔赴（CP检测）
 */
export interface TwoWayMention {
  member1Id: number
  member1Name: string
  member2Id: number
  member2Name: string
  member1To2: number // A @ B
  member2To1: number // B @ A
  total: number // 总互动次数
  balance: number // 平衡度 (较小值 / 较大值)，越接近 1 越平衡
}

/**
 * 成员的 @ 详情（点击成员查看其 @ 关系）
 */
export interface MemberMentionDetail {
  memberId: number
  name: string
  /** 该成员最常 @ 的人 TOP N */
  topMentioned: MentionPair[]
  /** 最常 @ 该成员的人 TOP N */
  topMentioners: MentionPair[]
}

/**
 * @ 互动分析结果
 */
export interface MentionAnalysis {
  /** 发起 @ 最多的人排行 */
  topMentioners: MentionRankItem[]
  /** 被 @ 最多的人排行 */
  topMentioned: MentionRankItem[]
  /** 单向关注列表 */
  oneWay: OneWayMention[]
  /** 双向奔赴列表（CP检测） */
  twoWay: TwoWayMention[]
  /** @ 总次数 */
  totalMentions: number
  /** 所有成员的 @ 详情（用于点击查看详细关系） */
  memberDetails: MemberMentionDetail[]
}

// ==================== 含笑量分析类型 ====================

/**
 * 含笑量排名项
 */
export interface LaughRankItem {
  memberId: number
  platformId: string
  name: string
  laughCount: number // 笑声关键词出现次数
  messageCount: number // 该成员总消息数
  laughRate: number // 含笑率（laughCount / messageCount * 100）
  percentage: number // 贡献占比（laughCount / 全群总笑声 * 100）
  keywordDistribution: Array<{
    keyword: string
    count: number
    percentage: number
  }> // 各关键词分布
}

/**
 * 笑声类型分布项
 */
export interface LaughTypeDistribution {
  type: string // 关键词类型（如 "哈哈"、"233" 等）
  count: number // 出现次数
  percentage: number // 占比
}

/**
 * 含笑量分析结果
 */
export interface LaughAnalysis {
  /** 按含笑率排序的排行榜 */
  rankByRate: LaughRankItem[]
  /** 按贡献度排序的排行榜 */
  rankByCount: LaughRankItem[]
  /** 笑声类型分布 */
  typeDistribution: LaughTypeDistribution[]
  /** 全群总笑声次数 */
  totalLaughs: number
  /** 全群总消息数 */
  totalMessages: number
  /** 群整体含笑率 */
  groupLaughRate: number
}

// ==================== 关键词模板 ====================

/**
 * 自定义关键词模板
 */
export interface KeywordTemplate {
  id: string
  name: string
  keywords: string[]
}

// ==================== 小团体关系图类型 ====================

/**
 * 小团体关系图参数
 */
export interface ClusterGraphOptions {
  /** 向后看几个不同发言者（默认3） */
  lookAhead?: number
  /** 时间衰减常数（秒，默认120） */
  decaySeconds?: number
  /** 最多保留边数（默认100） */
  topEdges?: number
}

/**
 * 小团体图节点
 */
export interface ClusterGraphNode {
  id: number
  name: string
  messageCount: number
  symbolSize: number
  degree: number
  normalizedDegree: number
}

/**
 * 小团体图边
 */
export interface ClusterGraphLink {
  source: string
  target: string
  value: number
  rawScore: number
  expectedScore: number
  coOccurrenceCount: number
}

/**
 * 小团体图社区
 */
export interface ClusterGraphCommunity {
  id: number
  name: string
  size: number
}

/**
 * 小团体图统计
 */
export interface ClusterGraphStats {
  totalMembers: number
  totalMessages: number
  involvedMembers: number
  edgeCount: number
  communityCount: number
}

/**
 * 小团体关系图结果
 */
export interface ClusterGraphData {
  nodes: ClusterGraphNode[]
  links: ClusterGraphLink[]
  maxLinkValue: number
  communities: ClusterGraphCommunity[]
  stats: ClusterGraphStats
}

// ==================== 关系主动性分析（私聊） ====================

export interface RelationshipMonthStats {
  month: string
  members: Array<{
    memberId: number
    name: string
    initiateCount: number
    closeCount: number
  }>
  totalSessions: number
}

export interface IceBreakerItem {
  month: string
  memberId: number
  name: string
  count: number
}

export interface ResponseLatencyMember {
  memberId: number
  name: string
  avgResponseTime: number
  totalResponses: number
}

export interface PerseveranceMember {
  memberId: number
  name: string
  totalDoubleTexts: number
}

export interface MonthlyResponseLatency {
  month: string
  members: Array<{
    memberId: number
    name: string
    avgResponseTime: number
    responseCount: number
  }>
}

export interface MonthlyPerseverance {
  month: string
  members: Array<{
    memberId: number
    name: string
    doubleTextCount: number
  }>
}

export interface RelationshipStats {
  months: RelationshipMonthStats[]
  members: Array<{
    memberId: number
    name: string
    totalInitiateCount: number
    totalCloseCount: number
  }>
  totalSessions: number
  hasSessionIndex: boolean
  iceBreakers: IceBreakerItem[]
  totalIceBreaks: number
  responseLatency: ResponseLatencyMember[]
  perseverance: PerseveranceMember[]
  totalDoubleTexts: number
  monthlyResponseLatency: MonthlyResponseLatency[]
  monthlyPerseverance: MonthlyPerseverance[]
  perseveranceThreshold: number
}
