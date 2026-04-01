/**
 * 数据库分析模块
 * 负责各种数据分析查询
 */

import type { MessageType } from '../../../src/types/base'
import type {
  MemberActivity,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  RepeatAnalysis,
  RepeatStatItem,
  RepeatRateItem,
  ChainLengthDistribution,
  HotRepeatContent,
  CatchphraseAnalysis,
  NightOwlAnalysis,
  NightOwlRankItem,
  NightOwlTitle,
  TimeRankItem,
  ConsecutiveNightRecord,
  NightOwlChampion,
  DragonKingAnalysis,
  DragonKingRankItem,
  DivingAnalysis,
  DivingRankItem,
} from '../../../src/types/analysis'
import { openDatabase } from './core'

/**
 * 时间过滤参数
 */
export interface TimeFilter {
  startTs?: number
  endTs?: number
}

/**
 * 构建时间过滤 WHERE 子句
 */
function buildTimeFilter(filter?: TimeFilter): { clause: string; params: number[] } {
  const conditions: string[] = []
  const params: number[] = []

  if (filter?.startTs !== undefined) {
    conditions.push('ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs !== undefined) {
    conditions.push('ts <= ?')
    params.push(filter.endTs)
  }

  return {
    clause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/**
 * 构建排除系统消息的过滤条件
 */
function buildSystemMessageFilter(existingClause: string): string {
  const systemFilter = "COALESCE(m.account_name, '') != '系统消息'"

  if (existingClause.includes('WHERE')) {
    return existingClause + ' AND ' + systemFilter
  } else {
    return ' WHERE ' + systemFilter
  }
}

/**
 * 获取可用的年份列表
 */
export function getAvailableYears(sessionId: string): number[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const rows = db
      .prepare(
        `
      SELECT DISTINCT CAST(strftime('%Y', ts, 'unixepoch', 'localtime') AS INTEGER) as year
      FROM message
      ORDER BY year DESC
    `
      )
      .all() as Array<{ year: number }>

    return rows.map((r) => r.year)
  } finally {
    db.close()
  }
}

/**
 * 获取成员活跃度排行
 */
export function getMemberActivity(sessionId: string, filter?: TimeFilter): MemberActivity[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const { clause, params } = buildTimeFilter(filter)

    const msgFilterBase = clause ? clause.replace('WHERE', 'AND') : ''
    const msgFilterWithSystem = msgFilterBase + " AND COALESCE(m.account_name, '') != '系统消息'"

    const totalClauseWithSystem = buildSystemMessageFilter(clause)
    const totalMessages = (
      db
        .prepare(
          `SELECT COUNT(*) as count
         FROM message msg
         JOIN member m ON msg.sender_id = m.id
         ${totalClauseWithSystem}`
        )
        .get(...params) as { count: number }
    ).count

    const rows = db
      .prepare(
        `
      SELECT
        m.id as memberId,
        m.platform_id as platformId,
        COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
        COUNT(msg.id) as messageCount
      FROM member m
      LEFT JOIN message msg ON m.id = msg.sender_id ${msgFilterWithSystem}
      WHERE COALESCE(m.account_name, '') != '系统消息'
      GROUP BY m.id
      HAVING messageCount > 0
      ORDER BY messageCount DESC
    `
      )
      .all(...params) as Array<{
      memberId: number
      platformId: string
      name: string
      messageCount: number
    }>

    return rows.map((row) => ({
      memberId: row.memberId,
      platformId: row.platformId,
      name: row.name,
      messageCount: row.messageCount,
      percentage: totalMessages > 0 ? Math.round((row.messageCount / totalMessages) * 10000) / 100 : 0,
    }))
  } finally {
    db.close()
  }
}

/**
 * 获取每小时活跃度分布
 */
export function getHourlyActivity(sessionId: string, filter?: TimeFilter): HourlyActivity[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    const rows = db
      .prepare(
        `
      SELECT
        CAST(strftime('%H', msg.ts, 'unixepoch', 'localtime') AS INTEGER) as hour,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY hour
      ORDER BY hour
    `
      )
      .all(...params) as Array<{ hour: number; messageCount: number }>

    const result: HourlyActivity[] = []
    for (let h = 0; h < 24; h++) {
      const found = rows.find((r) => r.hour === h)
      result.push({
        hour: h,
        messageCount: found ? found.messageCount : 0,
      })
    }

    return result
  } finally {
    db.close()
  }
}

/**
 * 获取每日活跃度趋势
 */
export function getDailyActivity(sessionId: string, filter?: TimeFilter): DailyActivity[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    const rows = db
      .prepare(
        `
      SELECT
        strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY date
      ORDER BY date
    `
      )
      .all(...params) as Array<{ date: string; messageCount: number }>

    return rows
  } finally {
    db.close()
  }
}

/**
 * 获取消息类型分布
 */
export function getMessageTypeDistribution(
  sessionId: string,
  filter?: TimeFilter
): Array<{ type: MessageType; count: number }> {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    const rows = db
      .prepare(
        `
      SELECT msg.type, COUNT(*) as count
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY msg.type
      ORDER BY count DESC
    `
      )
      .all(...params) as Array<{ type: number; count: number }>

    return rows.map((r) => ({
      type: r.type as MessageType,
      count: r.count,
    }))
  } finally {
    db.close()
  }
}

/**
 * 获取时间范围
 */
export function getTimeRange(sessionId: string): { start: number; end: number } | null {
  const db = openDatabase(sessionId)
  if (!db) return null

  try {
    const row = db
      .prepare(
        `
      SELECT MIN(ts) as start, MAX(ts) as end FROM message
    `
      )
      .get() as { start: number | null; end: number | null }

    if (row.start === null || row.end === null) return null

    return { start: row.start, end: row.end }
  } finally {
    db.close()
  }
}

/**
 * 获取成员的历史昵称记录
 */
export function getMemberNameHistory(
  sessionId: string,
  memberId: number
): Array<{ name: string; startTs: number; endTs: number | null }> {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const rows = db
      .prepare(
        `
      SELECT name, start_ts as startTs, end_ts as endTs
      FROM member_name_history
      WHERE member_id = ?
      ORDER BY start_ts DESC
    `
      )
      .all(memberId) as Array<{ name: string; startTs: number; endTs: number | null }>

    return rows
  } finally {
    db.close()
  }
}

/**
 * 获取复读分析数据
 * 使用滑动窗口算法检测复读链：
 * - 复读成立条件：至少 3 条连续的相同内容消息，且发送者不同
 * - 排除：系统消息、空消息、图片消息
 */
export function getRepeatAnalysis(sessionId: string, filter?: TimeFilter): RepeatAnalysis {
  const db = openDatabase(sessionId)
  const emptyResult: RepeatAnalysis = {
    originators: [],
    initiators: [],
    breakers: [],
    fastestRepeaters: [],
    originatorRates: [],
    initiatorRates: [],
    breakerRates: [],
    chainLengthDistribution: [],
    hotContents: [],
    avgChainLength: 0,
    totalRepeatChains: 0,
  }

  if (!db) {
    return emptyResult
  }

  try {
    const { clause, params } = buildTimeFilter(filter)

    let whereClause = clause
    if (whereClause.includes('WHERE')) {
      whereClause +=
        " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
    } else {
      whereClause =
        " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND TRIM(msg.content) != ''"
    }

    const messages = db
      .prepare(
        `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.content,
          msg.ts,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        ORDER BY msg.ts ASC, msg.id ASC
      `
      )
      .all(...params) as Array<{
      id: number
      senderId: number
      content: string
      ts: number
      platformId: string
      name: string
    }>

    const originatorCount = new Map<number, number>()
    const initiatorCount = new Map<number, number>()
    const breakerCount = new Map<number, number>()
    const memberMessageCount = new Map<number, number>()

    const memberInfo = new Map<number, { platformId: string; name: string }>()

    const chainLengthCount = new Map<number, number>()

    const contentStats = new Map<
      string,
      { count: number; maxChainLength: number; originatorId: number; lastTs: number; firstMessageId: number }
    >()

    let currentContent: string | null = null
    let repeatChain: Array<{ id: number; senderId: number; content: string; ts: number }> = []
    let totalRepeatChains = 0
    let totalChainLength = 0

    const processRepeatChain = (
      chain: Array<{ id: number; senderId: number; content: string; ts: number }>,
      breakerId?: number
    ) => {
      if (chain.length < 3) return

      totalRepeatChains++
      const chainLength = chain.length
      totalChainLength += chainLength

      const originatorId = chain[0].senderId
      originatorCount.set(originatorId, (originatorCount.get(originatorId) || 0) + 1)

      const initiatorId = chain[1].senderId
      initiatorCount.set(initiatorId, (initiatorCount.get(initiatorId) || 0) + 1)

      if (breakerId !== undefined) {
        breakerCount.set(breakerId, (breakerCount.get(breakerId) || 0) + 1)
      }

      chainLengthCount.set(chainLength, (chainLengthCount.get(chainLength) || 0) + 1)

      const content = chain[0].content
      const chainTs = chain[0].ts
      const firstMessageId = chain[0].id
      const existing = contentStats.get(content)
      if (existing) {
        existing.count++
        existing.lastTs = Math.max(existing.lastTs, chainTs)
        if (chainLength > existing.maxChainLength) {
          existing.maxChainLength = chainLength
          existing.originatorId = originatorId
          existing.firstMessageId = firstMessageId
        }
      } else {
        contentStats.set(content, {
          count: 1,
          maxChainLength: chainLength,
          originatorId,
          lastTs: chainTs,
          firstMessageId,
        })
      }
    }

    for (const msg of messages) {
      if (!memberInfo.has(msg.senderId)) {
        memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
      }

      memberMessageCount.set(msg.senderId, (memberMessageCount.get(msg.senderId) || 0) + 1)

      const content = msg.content.trim()

      if (content === currentContent) {
        const lastSender = repeatChain[repeatChain.length - 1]?.senderId
        if (lastSender !== msg.senderId) {
          repeatChain.push({ id: msg.id, senderId: msg.senderId, content, ts: msg.ts })
        }
      } else {
        processRepeatChain(repeatChain, msg.senderId)

        currentContent = content
        repeatChain = [{ id: msg.id, senderId: msg.senderId, content, ts: msg.ts }]
      }
    }

    processRepeatChain(repeatChain)

    const buildRankList = (countMap: Map<number, number>, total: number): RepeatStatItem[] => {
      const items: RepeatStatItem[] = []
      for (const [memberId, count] of countMap.entries()) {
        const info = memberInfo.get(memberId)
        if (info) {
          items.push({
            memberId,
            platformId: info.platformId,
            name: info.name,
            count,
            percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
          })
        }
      }
      return items.sort((a, b) => b.count - a.count)
    }

    const buildRateList = (countMap: Map<number, number>): RepeatRateItem[] => {
      const items: RepeatRateItem[] = []
      for (const [memberId, count] of countMap.entries()) {
        const info = memberInfo.get(memberId)
        const totalMessages = memberMessageCount.get(memberId) || 0
        if (info && totalMessages > 0) {
          items.push({
            memberId,
            platformId: info.platformId,
            name: info.name,
            count,
            totalMessages,
            rate: Math.round((count / totalMessages) * 10000) / 100,
          })
        }
      }
      return items.sort((a, b) => b.rate - a.rate)
    }

    const chainLengthDistribution: ChainLengthDistribution[] = []
    for (const [length, count] of chainLengthCount.entries()) {
      chainLengthDistribution.push({ length, count })
    }
    chainLengthDistribution.sort((a, b) => a.length - b.length)

    const hotContents: HotRepeatContent[] = []
    for (const [content, stats] of contentStats.entries()) {
      const originatorInfo = memberInfo.get(stats.originatorId)
      hotContents.push({
        content,
        count: stats.count,
        maxChainLength: stats.maxChainLength,
        originatorName: originatorInfo?.name || '未知',
        lastTs: stats.lastTs,
        firstMessageId: stats.firstMessageId,
      })
    }
    hotContents.sort((a, b) => b.maxChainLength - a.maxChainLength)
    const top10HotContents = hotContents.slice(0, 10)

    return {
      originators: buildRankList(originatorCount, totalRepeatChains),
      initiators: buildRankList(initiatorCount, totalRepeatChains),
      breakers: buildRankList(breakerCount, totalRepeatChains),
      fastestRepeaters: [],
      originatorRates: buildRateList(originatorCount),
      initiatorRates: buildRateList(initiatorCount),
      breakerRates: buildRateList(breakerCount),
      chainLengthDistribution,
      hotContents: top10HotContents,
      avgChainLength: totalRepeatChains > 0 ? Math.round((totalChainLength / totalRepeatChains) * 100) / 100 : 0,
      totalRepeatChains,
    }
  } finally {
    db.close()
  }
}

/**
 * 获取星期活跃度分布
 * 返回周一到周日的消息统计
 */
export function getWeekdayActivity(sessionId: string, filter?: TimeFilter): WeekdayActivity[] {
  const db = openDatabase(sessionId)
  if (!db) return []

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    // SQLite strftime('%w') 返回 0-6，0=周日
    // 我们需要转换为 1-7，1=周一，7=周日
    const rows = db
      .prepare(
        `
      SELECT
        CASE
          WHEN CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER) = 0 THEN 7
          ELSE CAST(strftime('%w', msg.ts, 'unixepoch', 'localtime') AS INTEGER)
        END as weekday,
        COUNT(*) as messageCount
      FROM message msg
      JOIN member m ON msg.sender_id = m.id
      ${clauseWithSystem}
      GROUP BY weekday
      ORDER BY weekday
    `
      )
      .all(...params) as Array<{ weekday: number; messageCount: number }>

    // 补全所有星期（1-7）
    const result: WeekdayActivity[] = []
    for (let w = 1; w <= 7; w++) {
      const found = rows.find((r) => r.weekday === w)
      result.push({
        weekday: w,
        messageCount: found ? found.messageCount : 0,
      })
    }

    return result
  } finally {
    db.close()
  }
}

/**
 * 获取口头禅分析数据
 * 统计每个成员最常说的内容（前5个）
 * - 排除：系统消息、空消息、图片消息
 * - 排除：过短的内容（少于2个字符）
 */
export function getCatchphraseAnalysis(sessionId: string, filter?: TimeFilter): CatchphraseAnalysis {
  const db = openDatabase(sessionId)
  if (!db) {
    return { members: [] }
  }

  try {
    const { clause, params } = buildTimeFilter(filter)

    let whereClause = clause
    if (whereClause.includes('WHERE')) {
      whereClause +=
        " AND COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
    } else {
      whereClause =
        " WHERE COALESCE(m.account_name, '') != '系统消息' AND msg.type = 0 AND msg.content IS NOT NULL AND LENGTH(TRIM(msg.content)) >= 2"
    }

    const rows = db
      .prepare(
        `
        SELECT
          m.id as memberId,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
          TRIM(msg.content) as content,
          COUNT(*) as count
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${whereClause}
        GROUP BY m.id, TRIM(msg.content)
        ORDER BY m.id, count DESC
      `
      )
      .all(...params) as Array<{
      memberId: number
      platformId: string
      name: string
      content: string
      count: number
    }>

    const memberMap = new Map<
      number,
      {
        memberId: number
        platformId: string
        name: string
        catchphrases: Array<{ content: string; count: number }>
      }
    >()

    for (const row of rows) {
      if (!memberMap.has(row.memberId)) {
        memberMap.set(row.memberId, {
          memberId: row.memberId,
          platformId: row.platformId,
          name: row.name,
          catchphrases: [],
        })
      }

      const member = memberMap.get(row.memberId)!
      if (member.catchphrases.length < 5) {
        member.catchphrases.push({
          content: row.content,
          count: row.count,
        })
      }
    }

    const members = Array.from(memberMap.values())
    members.sort((a, b) => {
      const aTotal = a.catchphrases.reduce((sum, c) => sum + c.count, 0)
      const bTotal = b.catchphrases.reduce((sum, c) => sum + c.count, 0)
      return bTotal - aTotal
    })

    return { members }
  } finally {
    db.close()
  }
}

/**
 * 根据深夜发言数获取称号
 */
function getNightOwlTitleByCount(count: number): NightOwlTitle {
  if (count === 0) return '养生达人'
  if (count <= 20) return '偶尔失眠'
  if (count <= 50) return '经常失眠'
  if (count <= 100) return '夜猫子'
  if (count <= 200) return '秃头预备役'
  if (count <= 500) return '修仙练习生'
  return '守夜冠军'
}

/**
 * 将时间戳转换为"调整后的日期"（以凌晨5点为界）
 * 05:00 之前的消息算作前一天
 */
function getAdjustedDate(ts: number): string {
  const date = new Date(ts * 1000)
  const hour = date.getHours()

  // 如果是凌晨 0-4 点，算作前一天
  if (hour < 5) {
    date.setDate(date.getDate() - 1)
  }

  return date.toISOString().split('T')[0]
}

/**
 * 格式化分钟数为 HH:MM
 */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

/**
 * 获取夜猫分析数据
 * 深夜时段定义：23:00-05:00
 * 一天定义：05:00 ~ 次日 04:59
 */
export function getNightOwlAnalysis(sessionId: string, filter?: TimeFilter): NightOwlAnalysis {
  const db = openDatabase(sessionId)
  const emptyResult: NightOwlAnalysis = {
    nightOwlRank: [],
    lastSpeakerRank: [],
    firstSpeakerRank: [],
    consecutiveRecords: [],
    champions: [],
    totalDays: 0,
  }

  if (!db) return emptyResult

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    // 1. 获取所有消息（用于多种分析）
    const messages = db
      .prepare(
        `
        SELECT
          msg.id,
          msg.sender_id as senderId,
          msg.ts,
          m.platform_id as platformId,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${clauseWithSystem}
        ORDER BY msg.ts ASC
      `
      )
      .all(...params) as Array<{
      id: number
      senderId: number
      ts: number
      platformId: string
      name: string
    }>

    if (messages.length === 0) return emptyResult

    // 成员信息映射
    const memberInfo = new Map<number, { platformId: string; name: string }>()

    // ========== 分析 1: 修仙排行榜 ==========
    const nightStats = new Map<
      number,
      {
        total: number
        h23: number
        h0: number
        h1: number
        h2: number
        h3to4: number
        totalMessages: number
      }
    >()

    // ========== 分析 2 & 3: 最晚/最早发言 ==========
    // 按调整后的日期分组消息
    const dailyMessages = new Map<string, Array<{ senderId: number; ts: number; hour: number; minute: number }>>()

    // ========== 分析 4: 连续修仙天数 ==========
    const memberNightDays = new Map<number, Set<string>>() // 成员 -> 有深夜发言的日期集合

    for (const msg of messages) {
      // 记录成员信息
      if (!memberInfo.has(msg.senderId)) {
        memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
      }

      const date = new Date(msg.ts * 1000)
      const hour = date.getHours()
      const minute = date.getMinutes()
      const adjustedDate = getAdjustedDate(msg.ts)

      // 初始化成员夜猫统计
      if (!nightStats.has(msg.senderId)) {
        nightStats.set(msg.senderId, { total: 0, h23: 0, h0: 0, h1: 0, h2: 0, h3to4: 0, totalMessages: 0 })
      }
      const stats = nightStats.get(msg.senderId)!
      stats.totalMessages++

      // 统计深夜发言 (23:00-05:00)
      if (hour === 23) {
        stats.h23++
        stats.total++
      } else if (hour === 0) {
        stats.h0++
        stats.total++
      } else if (hour === 1) {
        stats.h1++
        stats.total++
      } else if (hour === 2) {
        stats.h2++
        stats.total++
      } else if (hour >= 3 && hour < 5) {
        stats.h3to4++
        stats.total++
      }

      // 记录深夜发言的日期（用于连续天数统计）
      if (hour >= 23 || hour < 5) {
        if (!memberNightDays.has(msg.senderId)) {
          memberNightDays.set(msg.senderId, new Set())
        }
        memberNightDays.get(msg.senderId)!.add(adjustedDate)
      }

      // 按日期分组消息（用于最晚/最早发言统计）
      if (!dailyMessages.has(adjustedDate)) {
        dailyMessages.set(adjustedDate, [])
      }
      dailyMessages.get(adjustedDate)!.push({ senderId: msg.senderId, ts: msg.ts, hour, minute })
    }

    const totalDays = dailyMessages.size

    // ========== 构建修仙排行榜 ==========
    const nightOwlRank: NightOwlRankItem[] = []
    for (const [memberId, stats] of nightStats.entries()) {
      if (stats.total === 0) continue
      const info = memberInfo.get(memberId)!
      nightOwlRank.push({
        memberId,
        platformId: info.platformId,
        name: info.name,
        totalNightMessages: stats.total,
        title: getNightOwlTitleByCount(stats.total),
        hourlyBreakdown: {
          h23: stats.h23,
          h0: stats.h0,
          h1: stats.h1,
          h2: stats.h2,
          h3to4: stats.h3to4,
        },
        percentage: stats.totalMessages > 0 ? Math.round((stats.total / stats.totalMessages) * 10000) / 100 : 0,
      })
    }
    nightOwlRank.sort((a, b) => b.totalNightMessages - a.totalNightMessages)

    // ========== 构建最晚/最早发言排行 ==========
    const lastSpeakerStats = new Map<number, { count: number; times: number[] }>()
    const firstSpeakerStats = new Map<number, { count: number; times: number[] }>()

    for (const [, dayMessages] of dailyMessages.entries()) {
      if (dayMessages.length === 0) continue

      // 找到当天最后发言的人
      const lastMsg = dayMessages[dayMessages.length - 1]
      if (!lastSpeakerStats.has(lastMsg.senderId)) {
        lastSpeakerStats.set(lastMsg.senderId, { count: 0, times: [] })
      }
      const lastStats = lastSpeakerStats.get(lastMsg.senderId)!
      lastStats.count++
      lastStats.times.push(lastMsg.hour * 60 + lastMsg.minute)

      // 找到当天最早发言的人
      const firstMsg = dayMessages[0]
      if (!firstSpeakerStats.has(firstMsg.senderId)) {
        firstSpeakerStats.set(firstMsg.senderId, { count: 0, times: [] })
      }
      const firstStats = firstSpeakerStats.get(firstMsg.senderId)!
      firstStats.count++
      firstStats.times.push(firstMsg.hour * 60 + firstMsg.minute)
    }

    // 构建最晚发言排行
    const lastSpeakerRank: TimeRankItem[] = []
    for (const [memberId, stats] of lastSpeakerStats.entries()) {
      const info = memberInfo.get(memberId)!
      const avgMinutes = stats.times.reduce((a, b) => a + b, 0) / stats.times.length
      const maxMinutes = Math.max(...stats.times)
      lastSpeakerRank.push({
        memberId,
        platformId: info.platformId,
        name: info.name,
        count: stats.count,
        avgTime: formatMinutes(avgMinutes),
        extremeTime: formatMinutes(maxMinutes),
        percentage: totalDays > 0 ? Math.round((stats.count / totalDays) * 10000) / 100 : 0,
      })
    }
    lastSpeakerRank.sort((a, b) => b.count - a.count)

    // 构建最早发言排行
    const firstSpeakerRank: TimeRankItem[] = []
    for (const [memberId, stats] of firstSpeakerStats.entries()) {
      const info = memberInfo.get(memberId)!
      const avgMinutes = stats.times.reduce((a, b) => a + b, 0) / stats.times.length
      const minMinutes = Math.min(...stats.times)
      firstSpeakerRank.push({
        memberId,
        platformId: info.platformId,
        name: info.name,
        count: stats.count,
        avgTime: formatMinutes(avgMinutes),
        extremeTime: formatMinutes(minMinutes),
        percentage: totalDays > 0 ? Math.round((stats.count / totalDays) * 10000) / 100 : 0,
      })
    }
    firstSpeakerRank.sort((a, b) => b.count - a.count)

    // ========== 构建连续修仙天数记录 ==========
    const consecutiveRecords: ConsecutiveNightRecord[] = []

    for (const [memberId, nightDaysSet] of memberNightDays.entries()) {
      if (nightDaysSet.size === 0) continue

      const info = memberInfo.get(memberId)!
      const sortedDays = Array.from(nightDaysSet).sort()

      let maxStreak = 1
      let currentStreak = 1

      for (let i = 1; i < sortedDays.length; i++) {
        const prevDate = new Date(sortedDays[i - 1])
        const currDate = new Date(sortedDays[i])
        const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)

        if (diffDays === 1) {
          currentStreak++
          maxStreak = Math.max(maxStreak, currentStreak)
        } else {
          currentStreak = 1
        }
      }

      // 检查当前是否还在连续（最后一天是否是最近的）
      const lastDay = sortedDays[sortedDays.length - 1]
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      const isCurrentStreak = lastDay === today || lastDay === yesterday

      consecutiveRecords.push({
        memberId,
        platformId: info.platformId,
        name: info.name,
        maxConsecutiveDays: maxStreak,
        currentStreak: isCurrentStreak ? currentStreak : 0,
      })
    }
    consecutiveRecords.sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays)

    // ========== 构建修仙王者（综合排名） ==========
    // 综合得分 = 深夜发言数 × 1 + 最晚下班次数 × 10 + 连续修仙天数 × 20
    const championScores = new Map<
      number,
      { nightMessages: number; lastSpeakerCount: number; consecutiveDays: number }
    >()

    for (const item of nightOwlRank) {
      if (!championScores.has(item.memberId)) {
        championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
      }
      championScores.get(item.memberId)!.nightMessages = item.totalNightMessages
    }

    for (const item of lastSpeakerRank) {
      if (!championScores.has(item.memberId)) {
        championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
      }
      championScores.get(item.memberId)!.lastSpeakerCount = item.count
    }

    for (const item of consecutiveRecords) {
      if (!championScores.has(item.memberId)) {
        championScores.set(item.memberId, { nightMessages: 0, lastSpeakerCount: 0, consecutiveDays: 0 })
      }
      championScores.get(item.memberId)!.consecutiveDays = item.maxConsecutiveDays
    }

    const champions: NightOwlChampion[] = []
    for (const [memberId, scores] of championScores.entries()) {
      const info = memberInfo.get(memberId)!
      const score = scores.nightMessages * 1 + scores.lastSpeakerCount * 10 + scores.consecutiveDays * 20
      if (score > 0) {
        champions.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          score,
          nightMessages: scores.nightMessages,
          lastSpeakerCount: scores.lastSpeakerCount,
          consecutiveDays: scores.consecutiveDays,
        })
      }
    }
    champions.sort((a, b) => b.score - a.score)

    return {
      nightOwlRank,
      lastSpeakerRank,
      firstSpeakerRank,
      consecutiveRecords,
      champions,
      totalDays,
    }
  } finally {
    db.close()
  }
}

/**
 * 获取龙王排名
 * 每天发言最多的人+1，统计所有天数
 */
export function getDragonKingAnalysis(sessionId: string, filter?: TimeFilter): DragonKingAnalysis {
  const db = openDatabase(sessionId)
  const emptyResult: DragonKingAnalysis = {
    rank: [],
    totalDays: 0,
  }

  if (!db) return emptyResult

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    // 查询每天每个人的发言数，找出每天的龙王
    const dailyTopSpeakers = db
      .prepare(
        `
        WITH daily_counts AS (
          SELECT
            strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
            msg.sender_id,
            m.platform_id,
            COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
            COUNT(*) as msg_count
          FROM message msg
          JOIN member m ON msg.sender_id = m.id
          ${clauseWithSystem}
          GROUP BY date, msg.sender_id
        ),
        daily_max AS (
          SELECT date, MAX(msg_count) as max_count
          FROM daily_counts
          GROUP BY date
        )
        SELECT dc.sender_id, dc.platform_id, dc.name, COUNT(*) as dragon_days
        FROM daily_counts dc
        JOIN daily_max dm ON dc.date = dm.date AND dc.msg_count = dm.max_count
        GROUP BY dc.sender_id
        ORDER BY dragon_days DESC
      `
      )
      .all(...params) as Array<{
      sender_id: number
      platform_id: string
      name: string
      dragon_days: number
    }>

    // 获取总天数
    const totalDaysRow = db
      .prepare(
        `
        SELECT COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as total
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        ${clauseWithSystem}
      `
      )
      .get(...params) as { total: number }

    const totalDays = totalDaysRow.total

    const rank: DragonKingRankItem[] = dailyTopSpeakers.map((item) => ({
      memberId: item.sender_id,
      platformId: item.platform_id,
      name: item.name,
      count: item.dragon_days,
      percentage: totalDays > 0 ? Math.round((item.dragon_days / totalDays) * 10000) / 100 : 0,
    }))

    return { rank, totalDays }
  } finally {
    db.close()
  }
}

/**
 * 获取潜水排名
 * 所有人的最后一次发言记录，按时间倒序（最久没发言的在前面）
 */
export function getDivingAnalysis(sessionId: string, filter?: TimeFilter): DivingAnalysis {
  const db = openDatabase(sessionId)
  const emptyResult: DivingAnalysis = {
    rank: [],
  }

  if (!db) return emptyResult

  try {
    const { clause, params } = buildTimeFilter(filter)
    const clauseWithSystem = buildSystemMessageFilter(clause)

    // 查询每个成员的最后发言时间
    const lastMessages = db
      .prepare(
        `
        SELECT
          m.id as member_id,
          m.platform_id,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
          MAX(msg.ts) as last_ts
        FROM member m
        JOIN message msg ON m.id = msg.sender_id
        ${clauseWithSystem.replace('msg.', 'msg.')}
        GROUP BY m.id
        ORDER BY last_ts ASC
      `
      )
      .all(...params) as Array<{
      member_id: number
      platform_id: string
      name: string
      last_ts: number
    }>

    const now = Math.floor(Date.now() / 1000)

    const rank: DivingRankItem[] = lastMessages.map((item) => ({
      memberId: item.member_id,
      platformId: item.platform_id,
      name: item.name,
      lastMessageTs: item.last_ts,
      daysSinceLastMessage: Math.floor((now - item.last_ts) / 86400),
    }))

    return { rank }
  } finally {
    db.close()
  }
}
