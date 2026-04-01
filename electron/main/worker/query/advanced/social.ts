/**
 * 社交分析模块
 * 包含：@ 互动分析、含笑量分析
 */

import { openDatabase, buildTimeFilter, type TimeFilter } from '../../core'

// ==================== @ 互动分析 ====================

/**
 * 获取 @ 互动分析数据
 */
export function getMentionAnalysis(sessionId: string, filter?: TimeFilter): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    topMentioners: [],
    topMentioned: [],
    oneWay: [],
    twoWay: [],
    totalMentions: 0,
    memberDetails: [],
  }

  if (!db) return emptyResult

  // 1. 查询所有成员信息
  const members = db
    .prepare(
      `
      SELECT id, platform_id as platformId, COALESCE(group_nickname, account_name, platform_id) as name
      FROM member
      WHERE COALESCE(account_name, '') != '系统消息'
    `
    )
    .all() as Array<{ id: number; platformId: string; name: string }>

  if (members.length === 0) return emptyResult

  // 2. 构建昵称到成员ID的映射（包括历史昵称）
  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { platformId: string; name: string }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { platformId: member.platformId, name: member.name })
    // 当前昵称
    nameToMemberId.set(member.name, member.id)

    // 查询历史昵称
    const history = db
      .prepare(
        `
        SELECT name FROM member_name_history
        WHERE member_id = ?
      `
      )
      .all(member.id) as Array<{ name: string }>

    for (const h of history) {
      if (!nameToMemberId.has(h.name)) {
        nameToMemberId.set(h.name, member.id)
      }
    }
  }

  // 3. 查询所有消息（带时间过滤）
  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db
    .prepare(
      `
      SELECT
        msg.sender_id as senderId,
        msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
    `
    )
    .all(...params) as Array<{ senderId: number; content: string }>

  // 4. 解析 @ 并构建关系矩阵
  // mentionMatrix[fromId][toId] = count
  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionedCount = new Map<number, number>() // 被 @ 的次数
  const mentionerCount = new Map<number, number>() // 发起 @ 的次数
  let totalMentions = 0

  // @ 正则：匹配 @昵称（昵称不含空格和@）
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>() // 避免同一消息重复计数同一人

    for (const match of matches) {
      const mentionedName = match[1]
      const mentionedId = nameToMemberId.get(mentionedName)

      // 只统计能匹配到成员的 @，且不能 @ 自己
      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)
        totalMentions++

        // 更新矩阵
        if (!mentionMatrix.has(msg.senderId)) {
          mentionMatrix.set(msg.senderId, new Map())
        }
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)

        // 更新计数
        mentionerCount.set(msg.senderId, (mentionerCount.get(msg.senderId) || 0) + 1)
        mentionedCount.set(mentionedId, (mentionedCount.get(mentionedId) || 0) + 1)
      }
    }
  }

  if (totalMentions === 0) return emptyResult

  // 5. 构建排行榜
  const topMentioners: any[] = []
  for (const [memberId, count] of mentionerCount.entries()) {
    const info = memberIdToInfo.get(memberId)!
    topMentioners.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count,
      percentage: Math.round((count / totalMentions) * 10000) / 100,
    })
  }
  topMentioners.sort((a, b) => b.count - a.count)

  const topMentioned: any[] = []
  for (const [memberId, count] of mentionedCount.entries()) {
    const info = memberIdToInfo.get(memberId)!
    topMentioned.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      count,
      percentage: Math.round((count / totalMentions) * 10000) / 100,
    })
  }
  topMentioned.sort((a, b) => b.count - a.count)

  // 6. 检测单向关注
  // 条件：A @ B 的比例 >= 80%（即 B @ A / A @ B < 20%）
  const oneWay: any[] = []
  const processedPairs = new Set<string>()

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)

      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount

      // 只有总互动 >= 3 次才考虑
      if (total < 3) continue

      const ratio = fromToCount / total

      // 单向关注：一方占比 >= 80%
      if (ratio >= 0.8) {
        const fromInfo = memberIdToInfo.get(fromId)!
        const toInfo = memberIdToInfo.get(toId)!
        oneWay.push({
          fromMemberId: fromId,
          fromName: fromInfo.name,
          toMemberId: toId,
          toName: toInfo.name,
          fromToCount,
          toFromCount,
          ratio: Math.round(ratio * 100) / 100,
        })
      } else if (ratio <= 0.2) {
        // 反向单向关注
        const fromInfo = memberIdToInfo.get(fromId)!
        const toInfo = memberIdToInfo.get(toId)!
        oneWay.push({
          fromMemberId: toId,
          fromName: toInfo.name,
          toMemberId: fromId,
          toName: fromInfo.name,
          fromToCount: toFromCount,
          toFromCount: fromToCount,
          ratio: Math.round((1 - ratio) * 100) / 100,
        })
      }
    }
  }
  oneWay.sort((a, b) => b.fromToCount - a.fromToCount)

  // 7. 检测双向奔赴（CP检测）
  // 条件：双方互相 @ 总次数 >= 5 次，且比例在 30%-70% 之间
  const twoWay: any[] = []
  processedPairs.clear()

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    for (const [toId, fromToCount] of toMap.entries()) {
      const pairKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)

      const toFromCount = mentionMatrix.get(toId)?.get(fromId) || 0
      const total = fromToCount + toFromCount

      // 总互动 >= 5 次
      if (total < 5) continue

      // 必须双方都有 @
      if (toFromCount === 0 || fromToCount === 0) continue

      const ratio = Math.min(fromToCount, toFromCount) / Math.max(fromToCount, toFromCount)

      // 平衡度 >= 30%（即 30%-100%）
      if (ratio >= 0.3) {
        const member1Info = memberIdToInfo.get(fromId)!
        const member2Info = memberIdToInfo.get(toId)!
        twoWay.push({
          member1Id: fromId,
          member1Name: member1Info.name,
          member2Id: toId,
          member2Name: member2Info.name,
          member1To2: fromToCount,
          member2To1: toFromCount,
          total,
          balance: Math.round(ratio * 100) / 100,
        })
      }
    }
  }
  twoWay.sort((a, b) => b.total - a.total)

  // 8. 构建成员详情（每个成员的 @ 关系 TOP 5）
  const memberDetails: any[] = []

  for (const member of members) {
    const memberId = member.id
    const info = memberIdToInfo.get(memberId)!

    // 该成员最常 @ 的人
    const topMentionedByThis: any[] = []
    const toMap = mentionMatrix.get(memberId)
    if (toMap) {
      for (const [toId, count] of toMap.entries()) {
        const toInfo = memberIdToInfo.get(toId)!
        topMentionedByThis.push({
          fromMemberId: memberId,
          fromName: info.name,
          toMemberId: toId,
          toName: toInfo.name,
          count,
        })
      }
      topMentionedByThis.sort((a, b) => b.count - a.count)
    }

    // 最常 @ 该成员的人
    const topMentionersOfThis: any[] = []
    for (const [fromId, toMap] of mentionMatrix.entries()) {
      const count = toMap.get(memberId)
      if (count) {
        const fromInfo = memberIdToInfo.get(fromId)!
        topMentionersOfThis.push({
          fromMemberId: fromId,
          fromName: fromInfo.name,
          toMemberId: memberId,
          toName: info.name,
          count,
        })
      }
    }
    topMentionersOfThis.sort((a, b) => b.count - a.count)

    // 只有有数据的成员才添加
    if (topMentionedByThis.length > 0 || topMentionersOfThis.length > 0) {
      memberDetails.push({
        memberId,
        name: info.name,
        topMentioned: topMentionedByThis.slice(0, 5),
        topMentioners: topMentionersOfThis.slice(0, 5),
      })
    }
  }

  return {
    topMentioners,
    topMentioned,
    oneWay,
    twoWay,
    totalMentions,
    memberDetails,
  }
}

// ==================== @ 互动关系图数据 ====================

export interface MentionGraphNode {
  id: number
  name: string
  value: number // 消息数量（用于节点大小）
  symbolSize: number // 节点大小
}

export interface MentionGraphLink {
  source: string // 发起者名称
  target: string // 被艾特者名称
  value: number // @ 次数
}

export interface MentionGraphData {
  nodes: MentionGraphNode[]
  links: MentionGraphLink[]
  maxLinkValue: number // 最大边权重（用于归一化）
}

/**
 * 获取 @ 互动关系图数据（用于 ECharts Graph）
 */
export function getMentionGraph(sessionId: string, filter?: TimeFilter): MentionGraphData {
  const db = openDatabase(sessionId)
  const emptyResult: MentionGraphData = { nodes: [], links: [], maxLinkValue: 0 }

  if (!db) return emptyResult

  // 1. 查询所有成员信息和消息数量（不过滤消息数为 0 的成员，因为可能被 @ 但没发消息）
  const { clause, params } = buildTimeFilter(filter)
  const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
  const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

  const members = db
    .prepare(
      `
      SELECT
        m.id,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE COALESCE(m.account_name, '') != '系统消息'
      GROUP BY m.id
    `
    )
    .all(...params) as Array<{ id: number; platformId: string; name: string; messageCount: number }>

  if (members.length === 0) return emptyResult

  // 2. 构建昵称到成员ID的映射
  const nameToMemberId = new Map<string, number>()
  const memberIdToInfo = new Map<number, { name: string; messageCount: number }>()

  for (const member of members) {
    memberIdToInfo.set(member.id, { name: member.name, messageCount: member.messageCount })
    nameToMemberId.set(member.name, member.id)

    // 查询历史昵称
    const history = db.prepare(`SELECT name FROM member_name_history WHERE member_id = ?`).all(member.id) as Array<{
      name: string
    }>

    for (const h of history) {
      if (!nameToMemberId.has(h.name)) {
        nameToMemberId.set(h.name, member.id)
      }
    }
  }

  // 3. 查询包含 @ 的消息
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause +=
      " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  } else {
    whereClause =
      " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND msg.content LIKE '%@%'"
  }

  const messages = db
    .prepare(
      `
      SELECT msg.sender_id as senderId, msg.content
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
    `
    )
    .all(...params) as Array<{ senderId: number; content: string }>

  // 4. 解析 @ 并构建关系矩阵
  const mentionMatrix = new Map<number, Map<number, number>>()
  const mentionRegex = /@([^\s@]+)/g

  for (const msg of messages) {
    const matches = msg.content.matchAll(mentionRegex)
    const mentionedInThisMsg = new Set<number>()

    for (const match of matches) {
      const mentionedName = match[1]
      const mentionedId = nameToMemberId.get(mentionedName)

      if (mentionedId && mentionedId !== msg.senderId && !mentionedInThisMsg.has(mentionedId)) {
        mentionedInThisMsg.add(mentionedId)

        if (!mentionMatrix.has(msg.senderId)) {
          mentionMatrix.set(msg.senderId, new Map())
        }
        const fromMap = mentionMatrix.get(msg.senderId)!
        fromMap.set(mentionedId, (fromMap.get(mentionedId) || 0) + 1)
      }
    }
  }

  // 5. 构建 nodes（只包含有互动的成员）
  const involvedMemberIds = new Set<number>()
  for (const [fromId, toMap] of mentionMatrix.entries()) {
    involvedMemberIds.add(fromId)
    for (const toId of toMap.keys()) {
      involvedMemberIds.add(toId)
    }
  }

  const maxMessageCount = Math.max(...members.filter((m) => involvedMemberIds.has(m.id)).map((m) => m.messageCount), 1)

  const nodes: MentionGraphNode[] = []
  for (const memberId of involvedMemberIds) {
    const info = memberIdToInfo.get(memberId)
    if (info) {
      // 节点大小根据消息数量计算（20-60 范围）
      const symbolSize = 20 + (info.messageCount / maxMessageCount) * 40
      nodes.push({
        id: memberId,
        name: info.name,
        value: info.messageCount,
        symbolSize: Math.round(symbolSize),
      })
    }
  }

  // 6. 构建 links（使用 name 而非 ID，便于前端 ECharts 匹配）
  const links: MentionGraphLink[] = []
  let maxLinkValue = 0

  for (const [fromId, toMap] of mentionMatrix.entries()) {
    const fromInfo = memberIdToInfo.get(fromId)
    if (!fromInfo) continue

    for (const [toId, count] of toMap.entries()) {
      const toInfo = memberIdToInfo.get(toId)
      if (!toInfo) continue

      links.push({
        source: fromInfo.name,
        target: toInfo.name,
        value: count,
      })
      maxLinkValue = Math.max(maxLinkValue, count)
    }
  }

  return { nodes, links, maxLinkValue }
}

// ==================== 含笑量分析 ====================

/**
 * 将关键词转换为正则表达式模式
 */
function keywordToPattern(keyword: string): string {
  // 转义特殊字符
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // 特殊处理一些关键词的变体
  if (keyword === '哈哈') {
    return '哈哈+'
  }

  return escaped
}

/**
 * 获取含笑量分析数据
 * @param sessionId 会话ID
 * @param filter 时间过滤
 * @param keywords 自定义关键词列表（可选，默认使用内置列表）
 */
export function getLaughAnalysis(sessionId: string, filter?: TimeFilter, keywords?: string[]): any {
  const db = openDatabase(sessionId)
  const emptyResult = {
    rankByRate: [],
    rankByCount: [],
    typeDistribution: [],
    totalLaughs: 0,
    totalMessages: 0,
    groupLaughRate: 0,
  }

  if (!db) return emptyResult

  // 使用传入的关键词或默认关键词
  const laughKeywords = keywords && keywords.length > 0 ? keywords : []

  // 构建正则表达式
  const patterns = laughKeywords.map(keywordToPattern)
  const laughRegex = new RegExp(`(${patterns.join('|')})`, 'gi')

  // 查询所有消息
  const { clause, params } = buildTimeFilter(filter)

  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL"
  }

  const messages = db
    .prepare(
      `
      SELECT
        msg.sender_id as senderId,
        msg.content,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
    `
    )
    .all(...params) as Array<{
    senderId: number
    content: string
    platformId: string
    name: string
  }>

  if (messages.length === 0) return emptyResult

  // 统计数据
  const memberStats = new Map<
    number,
    {
      platformId: string
      name: string
      laughCount: number
      messageCount: number
      keywordCounts: Map<string, number> // 每个关键词的计数
    }
  >()
  const typeCount = new Map<string, number>()
  let totalLaughs = 0

  for (const msg of messages) {
    // 初始化成员统计
    if (!memberStats.has(msg.senderId)) {
      memberStats.set(msg.senderId, {
        platformId: msg.platformId,
        name: msg.name,
        laughCount: 0,
        messageCount: 0,
        keywordCounts: new Map(),
      })
    }

    const stats = memberStats.get(msg.senderId)!
    stats.messageCount++

    // 匹配笑声关键词
    const matches = msg.content.match(laughRegex)
    if (matches) {
      stats.laughCount += matches.length
      totalLaughs += matches.length

      // 统计类型分布
      for (const match of matches) {
        // 归类到对应的关键词类型
        let matchedType = '其他'
        for (const keyword of laughKeywords) {
          const pattern = new RegExp(`^${keywordToPattern(keyword)}$`, 'i')
          if (pattern.test(match)) {
            matchedType = keyword
            break
          }
        }
        typeCount.set(matchedType, (typeCount.get(matchedType) || 0) + 1)
        // 记录到成员的关键词计数
        stats.keywordCounts.set(matchedType, (stats.keywordCounts.get(matchedType) || 0) + 1)
      }
    }
  }

  const totalMessages = messages.length

  if (totalLaughs === 0) return emptyResult

  // 构建排行榜
  const rankItems: any[] = []
  for (const [memberId, stats] of memberStats.entries()) {
    if (stats.laughCount > 0) {
      // 构建该成员的关键词分布（按原始关键词顺序）
      const keywordDistribution: Array<{ keyword: string; count: number; percentage: number }> = []
      for (const keyword of laughKeywords) {
        const count = stats.keywordCounts.get(keyword) || 0
        if (count > 0) {
          keywordDistribution.push({
            keyword,
            count,
            percentage: Math.round((count / stats.laughCount) * 10000) / 100,
          })
        }
      }
      // 处理"其他"类型
      const otherCount = stats.keywordCounts.get('其他') || 0
      if (otherCount > 0) {
        keywordDistribution.push({
          keyword: '其他',
          count: otherCount,
          percentage: Math.round((otherCount / stats.laughCount) * 10000) / 100,
        })
      }

      rankItems.push({
        memberId,
        platformId: stats.platformId,
        name: stats.name,
        laughCount: stats.laughCount,
        messageCount: stats.messageCount,
        laughRate: Math.round((stats.laughCount / stats.messageCount) * 10000) / 100,
        percentage: Math.round((stats.laughCount / totalLaughs) * 10000) / 100,
        keywordDistribution,
      })
    }
  }

  // 按含笑率排序
  const rankByRate = [...rankItems].sort((a, b) => b.laughRate - a.laughRate)
  // 按贡献度（绝对数量）排序
  const rankByCount = [...rankItems].sort((a, b) => b.laughCount - a.laughCount)

  // 构建类型分布
  const typeDistribution: any[] = []
  for (const [type, count] of typeCount.entries()) {
    typeDistribution.push({
      type,
      count,
      percentage: Math.round((count / totalLaughs) * 10000) / 100,
    })
  }
  typeDistribution.sort((a, b) => b.count - a.count)

  return {
    rankByRate,
    rankByCount,
    typeDistribution,
    totalLaughs,
    totalMessages,
    groupLaughRate: Math.round((totalLaughs / totalMessages) * 10000) / 100,
  }
}

// ==================== 小团体关系图（时间相邻共现） ====================

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
 * 小团体图结果
 */
export interface ClusterGraphData {
  nodes: ClusterGraphNode[]
  links: ClusterGraphLink[]
  maxLinkValue: number
  communities: Array<{ id: number; name: string; size: number }>
  stats: {
    totalMembers: number
    totalMessages: number
    involvedMembers: number
    edgeCount: number
    communityCount: number
  }
}

const DEFAULT_CLUSTER_OPTIONS = {
  lookAhead: 3,
  decaySeconds: 120,
  topEdges: 100,
}

function roundNum(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clusterPairKey(aId: number, bId: number): string {
  return aId < bId ? `${aId}-${bId}` : `${bId}-${aId}`
}

/**
 * 获取小团体关系图（基于时间相邻共现）
 *
 * 算法原理：
 * 1. 相邻定义：消息A发出后，后续N个不同发言者视为与A的发言者"相邻"
 * 2. 时间衰减：越快出现的相邻者权重越高 (exp(-delta/decay))
 * 3. 归一化：raw_score / expected_score，去除"话唠偏差"
 * 4. 社区检测：加权标签传播
 */
export function getClusterGraph(
  sessionId: string,
  filter?: TimeFilter,
  options?: ClusterGraphOptions
): ClusterGraphData {
  const db = openDatabase(sessionId)
  const opts = { ...DEFAULT_CLUSTER_OPTIONS, ...options }

  const emptyResult: ClusterGraphData = {
    nodes: [],
    links: [],
    maxLinkValue: 0,
    communities: [],
    stats: {
      totalMembers: 0,
      totalMessages: 0,
      involvedMembers: 0,
      edgeCount: 0,
      communityCount: 0,
    },
  }

  if (!db) return emptyResult

  // 1. 查询所有成员
  const members = db
    .prepare(
      `
      SELECT 
        id, 
        platform_id as platformId, 
        COALESCE(group_nickname, account_name, platform_id) as name,
        (SELECT COUNT(*) FROM message WHERE sender_id = member.id) as messageCount
      FROM member
      WHERE COALESCE(account_name, '') != '系统消息'
    `
    )
    .all() as Array<{ id: number; platformId: string; name: string; messageCount: number }>

  if (members.length < 2) return { ...emptyResult, stats: { ...emptyResult.stats, totalMembers: members.length } }

  const memberInfo = new Map<number, { name: string; platformId: string; messageCount: number }>()
  for (const m of members) {
    memberInfo.set(m.id, { name: m.name, platformId: m.platformId, messageCount: m.messageCount })
  }

  // 2. 查询消息（按时间排序）
  const { clause, params } = buildTimeFilter(filter)
  let whereClause = clause
  if (whereClause.includes('WHERE')) {
    whereClause += " AND COALESCE(m.account_name, '') != '系统消息'"
  } else {
    whereClause = " WHERE COALESCE(m.account_name, '') != '系统消息'"
  }

  const messages = db
    .prepare(
      `
      SELECT msg.sender_id as senderId, msg.ts as ts
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${whereClause}
      ORDER BY msg.ts ASC, msg.id ASC
    `
    )
    .all(...params) as Array<{ senderId: number; ts: number }>

  if (messages.length < 2) {
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
    }
  }

  // 3. 统计每个成员的消息数（用于归一化）
  const memberMsgCount = new Map<number, number>()
  for (const msg of messages) {
    memberMsgCount.set(msg.senderId, (memberMsgCount.get(msg.senderId) || 0) + 1)
  }

  const totalMessages = messages.length

  // 4. 计算成员对的原始相邻分数
  const pairRawScore = new Map<string, number>()
  const pairCoOccurrence = new Map<string, number>()

  for (let i = 0; i < messages.length - 1; i++) {
    const anchor = messages[i]
    const seenPartners = new Set<number>()
    let partnersFound = 0

    // 向后看 lookAhead 个不同发言者
    for (let j = i + 1; j < messages.length && partnersFound < opts.lookAhead; j++) {
      const candidate = messages[j]

      // 跳过同一发言者
      if (candidate.senderId === anchor.senderId) continue
      // 跳过已计入的发言者
      if (seenPartners.has(candidate.senderId)) continue

      seenPartners.add(candidate.senderId)
      partnersFound++

      // 计算时间衰减权重
      const deltaSeconds = (candidate.ts - anchor.ts) / 1000
      const decayWeight = Math.exp(-deltaSeconds / opts.decaySeconds)
      // 位置衰减：第1个邻居权重1，第2个0.8，第3个0.6
      const positionWeight = 1 - (partnersFound - 1) * 0.2

      const weight = decayWeight * positionWeight
      const key = clusterPairKey(anchor.senderId, candidate.senderId)

      pairRawScore.set(key, (pairRawScore.get(key) || 0) + weight)
      pairCoOccurrence.set(key, (pairCoOccurrence.get(key) || 0) + 1)
    }
  }

  // 5. 归一化：计算期望分数并除以期望
  // 期望公式：expected = (A消息数/总数) × (B消息数/总数) × 总消息数 × 平均窗口覆盖率
  // 简化：expected ≈ (A消息数 × B消息数) / 总消息数 × lookAhead因子
  const lookAheadFactor = opts.lookAhead * 0.8 // 平均每条消息能覆盖的邻居数

  // 收集所有边和分数
  const rawEdges: Array<{
    sourceId: number
    targetId: number
    rawScore: number
    expectedScore: number
    normalizedScore: number
    coOccurrenceCount: number
  }> = []

  for (const [key, rawScore] of pairRawScore) {
    const [aIdStr, bIdStr] = key.split('-')
    const aId = parseInt(aIdStr)
    const bId = parseInt(bIdStr)

    const aMsgCount = memberMsgCount.get(aId) || 0
    const bMsgCount = memberMsgCount.get(bId) || 0

    // 期望分数（保留用于参考）
    const expectedScore = ((aMsgCount * bMsgCount) / totalMessages) * lookAheadFactor
    const normalizedScore = expectedScore > 0 ? rawScore / expectedScore : 0

    rawEdges.push({
      sourceId: aId,
      targetId: bId,
      rawScore,
      expectedScore,
      normalizedScore,
      coOccurrenceCount: pairCoOccurrence.get(key) || 0,
    })
  }

  // 计算最大分数，用于归一化到 [0, 1]
  const maxRawScore = Math.max(...rawEdges.map((e) => e.rawScore), 1)
  const maxNormalizedScore = Math.max(...rawEdges.map((e) => e.normalizedScore), 1)

  // 混合分数：50% 原始分数 + 50% 归一化分数
  const edges = rawEdges.map((e) => {
    const hybridScore = 0.5 * (e.rawScore / maxRawScore) + 0.5 * (e.normalizedScore / maxNormalizedScore)

    return {
      ...e,
      rawScore: roundNum(e.rawScore),
      expectedScore: roundNum(e.expectedScore),
      normalizedScore: roundNum(e.normalizedScore),
      hybridScore: roundNum(hybridScore),
    }
  })

  // 6. 按原始分数排序，取 Top N
  edges.sort((a, b) => b.hybridScore - a.hybridScore)
  const keptEdges = edges.slice(0, opts.topEdges)

  if (keptEdges.length === 0) {
    return {
      ...emptyResult,
      stats: { ...emptyResult.stats, totalMembers: members.length, totalMessages: messages.length },
    }
  }

  // 7. 找出参与的成员
  const involvedIds = new Set<number>()
  for (const edge of keptEdges) {
    involvedIds.add(edge.sourceId)
    involvedIds.add(edge.targetId)
  }

  // 8. 计算节点度数（使用混合分数）
  const nodeDegree = new Map<number, number>()
  for (const edge of keptEdges) {
    nodeDegree.set(edge.sourceId, (nodeDegree.get(edge.sourceId) || 0) + edge.hybridScore)
    nodeDegree.set(edge.targetId, (nodeDegree.get(edge.targetId) || 0) + edge.hybridScore)
  }
  const maxDegree = Math.max(...nodeDegree.values(), 1)

  // 10. 构建唯一显示名称（处理同名）
  const nameCount = new Map<string, number>()
  for (const id of involvedIds) {
    const name = memberInfo.get(id)?.name || String(id)
    nameCount.set(name, (nameCount.get(name) || 0) + 1)
  }

  const displayNames = new Map<number, string>()
  for (const id of involvedIds) {
    const info = memberInfo.get(id)
    const baseName = info?.name || String(id)
    if ((nameCount.get(baseName) || 0) > 1) {
      displayNames.set(id, `${baseName}#${(info?.platformId || String(id)).slice(-4)}`)
    } else {
      displayNames.set(id, baseName)
    }
  }

  // 11. 构建输出
  const maxMsgCount = Math.max(...[...involvedIds].map((id) => memberInfo.get(id)?.messageCount || 0), 1)

  const nodes: ClusterGraphNode[] = [...involvedIds].map((id) => {
    const info = memberInfo.get(id)!
    const degree = nodeDegree.get(id) || 0
    const normalizedDegree = degree / maxDegree
    const msgNorm = info.messageCount / maxMsgCount
    // 节点大小：70% 基于度数，30% 基于消息数
    const symbolSize = 20 + (0.7 * normalizedDegree + 0.3 * msgNorm) * 35

    return {
      id,
      name: displayNames.get(id)!,
      messageCount: info.messageCount,
      symbolSize: Math.round(symbolSize),
      degree: roundNum(degree),
      normalizedDegree: roundNum(normalizedDegree),
    }
  })

  nodes.sort((a, b) => b.degree - a.degree)

  const maxLinkValue = keptEdges.length > 0 ? Math.max(...keptEdges.map((e) => e.hybridScore)) : 0

  const links: ClusterGraphLink[] = keptEdges.map((e) => ({
    source: displayNames.get(e.sourceId)!,
    target: displayNames.get(e.targetId)!,
    value: e.hybridScore, // 使用混合分数作为主要输出
    rawScore: e.rawScore,
    expectedScore: e.expectedScore,
    coOccurrenceCount: e.coOccurrenceCount,
  }))

  return {
    nodes,
    links,
    maxLinkValue: roundNum(maxLinkValue),
    communities: [], // 保留字段兼容性，但不再计算
    stats: {
      totalMembers: members.length,
      totalMessages: messages.length,
      involvedMembers: involvedIds.size,
      edgeCount: keptEdges.length,
      communityCount: 0,
    },
  }
}
