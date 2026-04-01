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

// ==================== 夜猫分析类型 ====================

/**
 * 夜猫称号等级
 */
export type NightOwlTitle = '养生达人' | '偶尔失眠' | '经常失眠' | '夜猫子' | '秃头预备役' | '修仙练习生' | '守夜冠军'

/**
 * 修仙排行榜项
 */
export interface NightOwlRankItem {
  memberId: number
  platformId: string
  name: string
  totalNightMessages: number // 深夜发言总数
  title: NightOwlTitle // 称号
  hourlyBreakdown: {
    // 各时段分布
    h23: number // 23:00-24:00
    h0: number // 00:00-01:00
    h1: number // 01:00-02:00
    h2: number // 02:00-03:00
    h3to4: number // 03:00-05:00
  }
  percentage: number // 占该用户总发言的百分比
}

/**
 * 最晚/最早发言排行项
 */
export interface TimeRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 成为最晚/最早发言者的次数
  avgTime: string // 平均时间，格式 "HH:MM"
  extremeTime: string // 最极端时间，格式 "HH:MM"
  percentage: number // 占总天数的百分比
}

/**
 * 连续修仙记录
 */
export interface ConsecutiveNightRecord {
  memberId: number
  platformId: string
  name: string
  maxConsecutiveDays: number // 最长连续修仙天数
  currentStreak: number // 当前连续天数（如果还在持续）
}

/**
 * 修仙王者项（综合排名）
 */
export interface NightOwlChampion {
  memberId: number
  platformId: string
  name: string
  score: number // 综合得分
  nightMessages: number // 深夜发言数
  lastSpeakerCount: number // 最晚下班次数
  consecutiveDays: number // 最长连续天数
}

/**
 * 夜猫分析完整结果
 */
export interface NightOwlAnalysis {
  /** 修仙排行榜 */
  nightOwlRank: NightOwlRankItem[]
  /** 最晚下班排名 */
  lastSpeakerRank: TimeRankItem[]
  /** 最早上班排名 */
  firstSpeakerRank: TimeRankItem[]
  /** 连续修仙记录 */
  consecutiveRecords: ConsecutiveNightRecord[]
  /** 修仙王者（综合排名） */
  champions: NightOwlChampion[]
  /** 统计的总天数 */
  totalDays: number
}

/**
 * 龙王排名项（每天发言最多的人）
 */
export interface DragonKingRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 成为龙王的天数
  percentage: number // 占总天数的百分比
}

/**
 * 龙王分析结果
 */
export interface DragonKingAnalysis {
  rank: DragonKingRankItem[]
  totalDays: number // 统计的总天数
}

/**
 * 潜水排名项（最后发言时间）
 */
export interface DivingRankItem {
  memberId: number
  platformId: string
  name: string
  lastMessageTs: number // 最后发言时间戳（秒）
  daysSinceLastMessage: number // 距离最后发言的天数
}

/**
 * 潜水分析结果
 */
export interface DivingAnalysis {
  rank: DivingRankItem[]
}

// ==================== 复读分析类型 ====================

/**
 * 复读统计项（单个成员）- 绝对次数
 */
export interface RepeatStatItem {
  memberId: number
  platformId: string
  name: string
  count: number // 统计次数
  percentage: number // 占总复读链的百分比
}

/**
 * 复读率统计项（单个成员）- 相对比例
 */
export interface RepeatRateItem {
  memberId: number
  platformId: string
  name: string
  count: number // 复读相关次数
  totalMessages: number // 该成员总发言数
  rate: number // 复读率（百分比）
}

/**
 * 复读链长度分布项
 */
export interface ChainLengthDistribution {
  length: number // 复读链长度（参与人数）
  count: number // 出现次数
}

/**
 * 热门复读内容项
 */
export interface HotRepeatContent {
  content: string // 复读内容
  count: number // 被复读次数
  maxChainLength: number // 最长复读链长度
  originatorName: string // 最长链的原创者名称
  lastTs: number // 最近一次发生的时间戳（秒）
  firstMessageId: number // 最长链的第一条消息 ID（用于跳转查看上下文）
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

/**
 * 最快复读选手统计项
 */
export interface FastestRepeaterItem {
  memberId: number
  platformId: string
  name: string
  count: number // 参与复读次数
  avgTimeDiff: number // 平均反应时间（毫秒）
}

/**
 * 复读分析结果
 */
export interface RepeatAnalysis {
  /** 谁的聊天最容易产生复读（原创者）- 绝对次数 */
  originators: RepeatStatItem[]
  /** 谁最喜欢挑起复读（第二个复读的人）- 绝对次数 */
  initiators: RepeatStatItem[]
  /** 谁喜欢打断复读（终结者）- 绝对次数 */
  breakers: RepeatStatItem[]
  /** 最快复读选手（平均反应时间） */
  fastestRepeaters: FastestRepeaterItem[]

  /** 被复读率排名（相对比例） */
  originatorRates: RepeatRateItem[]
  /** 挑起复读率排名（相对比例） */
  initiatorRates: RepeatRateItem[]
  /** 打断复读率排名（相对比例） */
  breakerRates: RepeatRateItem[]

  /** 复读链长度分布 */
  chainLengthDistribution: ChainLengthDistribution[]
  /** 最火复读内容 TOP 10 */
  hotContents: HotRepeatContent[]
  /** 平均复读链长度 */
  avgChainLength: number

  /** 复读链总数 */
  totalRepeatChains: number
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

// ==================== 斗图分析类型 ====================

/**
 * 斗图达人榜项
 */
export interface MemeBattleRankItem {
  memberId: number
  platformId: string
  name: string
  count: number // 参与场次 或 图片总数
  percentage: number // 占比
}

/**
 * 斗图记录（一场）
 */
export interface MemeBattleRecord {
  startTime: number // 开始时间戳
  endTime: number // 结束时间戳
  totalImages: number // 总图片数
  participantCount: number // 参与人数
  participants: Array<{
    memberId: number
    name: string
    imageCount: number // 在该场斗图中发的图片数
  }>
}

/**
 * 斗图分析结果
 */
export interface MemeBattleAnalysis {
  topBattles: MemeBattleRecord[] // 史诗级斗图榜（前30）
  rankByCount: MemeBattleRankItem[] // 按参与场次排名
  rankByImageCount: MemeBattleRankItem[] // 按图片总数排名
  totalBattles: number // 总斗图场次
}

// ==================== 打卡分析类型 ====================

/**
 * 火花榜项（连续发言天数）
 */
export interface StreakRankItem {
  memberId: number
  name: string
  maxStreak: number // 最长连续天数
  maxStreakStart: string // 最长连续开始日期 (YYYY-MM-DD)
  maxStreakEnd: string // 最长连续结束日期 (YYYY-MM-DD)
  currentStreak: number // 当前连续天数（0表示已中断）
}

/**
 * 忠臣榜项（累计发言天数）
 */
export interface LoyaltyRankItem {
  memberId: number
  name: string
  totalDays: number // 累计发言天数
  percentage: number // 相对于第一名的百分比
}

/**
 * 打卡分析结果
 */
export interface CheckInAnalysis {
  streakRank: StreakRankItem[] // 火花榜 - 连续发言天数排名
  loyaltyRank: LoyaltyRankItem[] // 忠臣榜 - 累计发言天数排名
  totalDays: number // 群聊总天数
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
