/**
 * chart-cluster 插件类型定义
 * 小团体关系图（基于消息时间相邻共现分析）
 */

/** 模型参数 */
export interface ClusterGraphOptions {
  /** 向后看几个不同发言者（默认3） */
  lookAhead?: number
  /** 时间衰减常数（秒，默认120） */
  decaySeconds?: number
  /** 最多保留边数（默认150） */
  topEdges?: number
}

/** 成员原始数据（SQL 查询结果） */
export interface MemberRow {
  id: number
  platformId: string
  name: string
  messageCount: number
}

/** 消息原始数据（SQL 查询结果） */
export interface MessageRow {
  senderId: number
  ts: number
}

/** 关系图节点 */
export interface ClusterGraphNode {
  id: number
  name: string
  messageCount: number
  symbolSize: number
  degree: number
  normalizedDegree: number
}

/** 关系图边 */
export interface ClusterGraphLink {
  source: string
  target: string
  value: number
  rawScore: number
  expectedScore: number
  coOccurrenceCount: number
}

/** 关系图社区（保留兼容） */
export interface ClusterGraphCommunity {
  id: number
  name: string
  size: number
}

/** 关系图统计 */
export interface ClusterGraphStats {
  totalMembers: number
  totalMessages: number
  involvedMembers: number
  edgeCount: number
  communityCount: number
}

/** 关系图完整数据 */
export interface ClusterGraphData {
  nodes: ClusterGraphNode[]
  links: ClusterGraphLink[]
  maxLinkValue: number
  communities: ClusterGraphCommunity[]
  stats: ClusterGraphStats
}

/** ctx.db.compute 输入数据 */
export interface BuildClusterInput {
  members: MemberRow[]
  messages: MessageRow[]
  options: Required<ClusterGraphOptions>
}
