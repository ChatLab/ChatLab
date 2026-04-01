/**
 * chart-ranking SQL 查询与计算
 * 通过 pluginQuery (SQL) + pluginCompute (计算) 在 Worker 线程执行
 */

import type {
  DragonKingAnalysis,
  DragonKingRankItem,
  DivingAnalysis,
  DivingRankItem,
  CheckInAnalysis,
  NightOwlAnalysis,
  NightOwlTitle,
  MemeBattleAnalysis,
  RepeatAnalysis,
} from './types'

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number | null
}

function buildFilter(filter?: TimeFilter): { conditions: string; params: any[] } {
  const parts: string[] = []
  const params: any[] = []
  if (filter?.startTs != null) {
    parts.push('AND msg.ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs != null) {
    parts.push('AND msg.ts <= ?')
    params.push(filter.endTs)
  }
  if (filter?.memberId != null) {
    parts.push('AND msg.sender_id = ?')
    params.push(filter.memberId)
  }
  return { conditions: parts.join(' '), params }
}

const SYSTEM_FILTER = "AND COALESCE(m.account_name, '') != '系统消息'"

// ==================== 龙王分析 ====================

export async function queryDragonKingAnalysis(sessionId: string, timeFilter?: TimeFilter): Promise<DragonKingAnalysis> {
  const { conditions, params } = buildFilter(timeFilter)

  const [rankRows, totalRow] = await Promise.all([
    window.chatApi.pluginQuery<{
      sender_id: number
      platform_id: string
      name: string
      dragon_days: number
    }>(
      sessionId,
      `WITH daily_counts AS (
        SELECT
          strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime') as date,
          msg.sender_id,
          m.platform_id,
          COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
          COUNT(*) as msg_count
        FROM message msg
        JOIN member m ON msg.sender_id = m.id
        WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
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
      ORDER BY dragon_days DESC`,
      params
    ),
    window.chatApi.pluginQuery<{ total: number }>(
      sessionId,
      `SELECT COUNT(DISTINCT strftime('%Y-%m-%d', msg.ts, 'unixepoch', 'localtime')) as total
       FROM message msg
       JOIN member m ON msg.sender_id = m.id
       WHERE 1=1 ${SYSTEM_FILTER} ${conditions}`,
      params
    ),
  ])

  const totalDays = totalRow[0]?.total ?? 0
  const rank: DragonKingRankItem[] = rankRows.map((item) => ({
    memberId: item.sender_id,
    platformId: item.platform_id,
    name: item.name,
    count: item.dragon_days,
    percentage: totalDays > 0 ? Math.round((item.dragon_days / totalDays) * 10000) / 100 : 0,
  }))

  return { rank, totalDays }
}

// ==================== 潜水分析 ====================

export async function queryDivingAnalysis(sessionId: string, timeFilter?: TimeFilter): Promise<DivingAnalysis> {
  const { conditions, params } = buildFilter(timeFilter)

  const rows = await window.chatApi.pluginQuery<{
    member_id: number
    platform_id: string
    name: string
    last_ts: number
  }>(
    sessionId,
    `SELECT
      m.id as member_id,
      m.platform_id,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
      MAX(msg.ts) as last_ts
    FROM member m
    JOIN message msg ON m.id = msg.sender_id
    WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
    GROUP BY m.id
    ORDER BY last_ts ASC`,
    params
  )

  const now = Math.floor(Date.now() / 1000)
  const rank: DivingRankItem[] = rows.map((item) => ({
    memberId: item.member_id,
    platformId: item.platform_id,
    name: item.name,
    lastMessageTs: item.last_ts,
    daysSinceLastMessage: Math.floor((now - item.last_ts) / 86400),
  }))

  return { rank }
}

// ==================== 打卡分析 ====================

function computeCheckIn(input: {
  dailyActivity: Array<{ senderId: number; name: string; day: string }>
}): CheckInAnalysis {
  const { dailyActivity } = input
  if (dailyActivity.length === 0) {
    return { streakRank: [], loyaltyRank: [], totalDays: 0 }
  }

  const allDays = new Set(dailyActivity.map((r) => r.day))
  const totalDays = allDays.size
  const sortedDays = Array.from(allDays).sort()
  const lastDay = sortedDays[sortedDays.length - 1]

  const memberDays = new Map<number, { name: string; days: Set<string> }>()
  for (const record of dailyActivity) {
    if (!memberDays.has(record.senderId)) {
      memberDays.set(record.senderId, { name: record.name, days: new Set() })
    }
    memberDays.get(record.senderId)!.days.add(record.day)
  }

  const streakData: Array<{
    memberId: number
    name: string
    maxStreak: number
    maxStreakStart: string
    maxStreakEnd: string
    currentStreak: number
  }> = []

  const loyaltyData: Array<{
    memberId: number
    name: string
    totalDays: number
  }> = []

  for (const [memberId, data] of memberDays) {
    const sortedMemberDays = Array.from(data.days).sort()
    const totalMemberDays = sortedMemberDays.length

    let maxStreak = 1
    let maxStreakStart = sortedMemberDays[0]
    let maxStreakEnd = sortedMemberDays[0]
    let currentStreakCount = 1
    let currentStreakStart = sortedMemberDays[0]

    for (let i = 1; i < sortedMemberDays.length; i++) {
      const prevDate = new Date(sortedMemberDays[i - 1])
      const currDate = new Date(sortedMemberDays[i])
      const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))

      if (diffDays === 1) {
        currentStreakCount++
      } else {
        if (currentStreakCount > maxStreak) {
          maxStreak = currentStreakCount
          maxStreakStart = currentStreakStart
          maxStreakEnd = sortedMemberDays[i - 1]
        }
        currentStreakCount = 1
        currentStreakStart = sortedMemberDays[i]
      }
    }

    if (currentStreakCount > maxStreak) {
      maxStreak = currentStreakCount
      maxStreakStart = currentStreakStart
      maxStreakEnd = sortedMemberDays[sortedMemberDays.length - 1]
    }

    let finalCurrentStreak = 0
    if (sortedMemberDays[sortedMemberDays.length - 1] === lastDay) {
      finalCurrentStreak = 1
      for (let i = sortedMemberDays.length - 2; i >= 0; i--) {
        const currDate = new Date(sortedMemberDays[i + 1])
        const prevDate = new Date(sortedMemberDays[i])
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays === 1) {
          finalCurrentStreak++
        } else {
          break
        }
      }
    }

    streakData.push({
      memberId,
      name: data.name,
      maxStreak,
      maxStreakStart,
      maxStreakEnd,
      currentStreak: finalCurrentStreak,
    })

    loyaltyData.push({
      memberId,
      name: data.name,
      totalDays: totalMemberDays,
    })
  }

  const streakRank = streakData.sort((a, b) => b.maxStreak - a.maxStreak)
  const sortedLoyalty = loyaltyData.sort((a, b) => b.totalDays - a.totalDays)
  const maxLoyaltyDays = sortedLoyalty.length > 0 ? sortedLoyalty[0].totalDays : 1
  const loyaltyRank = sortedLoyalty.map((item) => ({
    ...item,
    percentage: Math.round((item.totalDays / maxLoyaltyDays) * 100),
  }))

  return { streakRank, loyaltyRank, totalDays }
}

export async function queryCheckInAnalysis(sessionId: string, timeFilter?: TimeFilter): Promise<CheckInAnalysis> {
  const { conditions, params } = buildFilter(timeFilter)

  const dailyActivity = await window.chatApi.pluginQuery<{
    senderId: number
    name: string
    day: string
  }>(
    sessionId,
    `SELECT
      msg.sender_id as senderId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
      DATE(msg.ts, 'unixepoch', 'localtime') as day
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
    GROUP BY msg.sender_id, day
    ORDER BY msg.sender_id, day`,
    params
  )

  if (dailyActivity.length === 0) {
    return { streakRank: [], loyaltyRank: [], totalDays: 0 }
  }

  return window.chatApi.pluginCompute<CheckInAnalysis>(computeCheckIn.toString(), { dailyActivity })
}

// ==================== 斗图分析 ====================

function computeMemeBattle(input: {
  messages: Array<{ senderId: number; type: number; ts: number; platformId: string; name: string }>
}): MemeBattleAnalysis {
  const { messages } = input
  const emptyResult: MemeBattleAnalysis = {
    topBattles: [],
    rankByCount: [],
    rankByImageCount: [],
    totalBattles: 0,
  }

  const battles: Array<{
    startTime: number
    endTime: number
    msgs: Array<{ senderId: number; name: string; platformId: string }>
  }> = []

  let currentChain: Array<{ senderId: number; name: string; platformId: string; ts: number }> = []

  const processChain = () => {
    if (currentChain.length >= 3) {
      const senders = new Set(currentChain.map((m) => m.senderId))
      if (senders.size >= 2) {
        battles.push({
          startTime: currentChain[0].ts,
          endTime: currentChain[currentChain.length - 1].ts,
          msgs: currentChain.map(({ senderId, name, platformId }) => ({ senderId, name, platformId })),
        })
      }
    }
    currentChain = []
  }

  for (const msg of messages) {
    if (msg.type === 1 || msg.type === 5) {
      currentChain.push({
        senderId: msg.senderId,
        name: msg.name,
        platformId: msg.platformId,
        ts: msg.ts,
      })
    } else {
      processChain()
    }
  }
  processChain()

  if (battles.length === 0) return emptyResult

  const topBattles = battles
    .map((battle) => ({
      startTime: battle.startTime,
      endTime: battle.endTime,
      totalImages: battle.msgs.length,
      participantCount: new Set(battle.msgs.map((m) => m.senderId)).size,
      participants: Object.values(
        battle.msgs.reduce((acc: Record<number, { memberId: number; name: string; imageCount: number }>, curr) => {
          if (!acc[curr.senderId]) {
            acc[curr.senderId] = { memberId: curr.senderId, name: curr.name, imageCount: 0 }
          }
          acc[curr.senderId].imageCount++
          return acc
        }, {})
      ).sort((a: any, b: any) => b.imageCount - a.imageCount),
    }))
    .sort((a, b) => b.totalImages - a.totalImages)
    .slice(0, 30)

  const memberStats = new Map<
    number,
    { memberId: number; platformId: string; name: string; battleCount: number; imageCount: number }
  >()

  for (const battle of battles) {
    const participantsInBattle = new Set<number>()
    for (const msg of battle.msgs) {
      if (!memberStats.has(msg.senderId)) {
        memberStats.set(msg.senderId, {
          memberId: msg.senderId,
          platformId: msg.platformId,
          name: msg.name,
          battleCount: 0,
          imageCount: 0,
        })
      }
      memberStats.get(msg.senderId)!.imageCount++
      participantsInBattle.add(msg.senderId)
    }
    for (const memberId of participantsInBattle) {
      memberStats.get(memberId)!.battleCount++
    }
  }

  const allStats = Array.from(memberStats.values())

  const rankByCount = [...allStats]
    .sort((a, b) => b.battleCount - a.battleCount)
    .map((item) => ({
      memberId: item.memberId,
      platformId: item.platformId,
      name: item.name,
      count: item.battleCount,
      percentage: battles.length > 0 ? Math.round((item.battleCount / battles.length) * 10000) / 100 : 0,
    }))

  const totalBattleImages = battles.reduce((sum, b) => sum + b.msgs.length, 0)
  const rankByImageCount = [...allStats]
    .sort((a, b) => b.imageCount - a.imageCount)
    .map((item) => ({
      memberId: item.memberId,
      platformId: item.platformId,
      name: item.name,
      count: item.imageCount,
      percentage: totalBattleImages > 0 ? Math.round((item.imageCount / totalBattleImages) * 10000) / 100 : 0,
    }))

  return {
    topBattles,
    rankByCount,
    rankByImageCount,
    totalBattles: battles.length,
  }
}

export async function queryMemeBattleAnalysis(sessionId: string, timeFilter?: TimeFilter): Promise<MemeBattleAnalysis> {
  const { conditions, params } = buildFilter(timeFilter)

  const messages = await window.chatApi.pluginQuery<{
    senderId: number
    type: number
    ts: number
    platformId: string
    name: string
  }>(
    sessionId,
    `SELECT
      msg.sender_id as senderId,
      msg.type,
      msg.ts,
      m.platform_id as platformId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE msg.type != 6 ${conditions}
    ORDER BY msg.ts ASC`,
    params
  )

  if (messages.length === 0) {
    return { topBattles: [], rankByCount: [], rankByImageCount: [], totalBattles: 0 }
  }

  return window.chatApi.pluginCompute<MemeBattleAnalysis>(computeMemeBattle.toString(), { messages })
}

// ==================== 夜猫分析 ====================

function computeNightOwl(input: {
  messages: Array<{ id: number; senderId: number; ts: number; platformId: string; name: string }>
}): NightOwlAnalysis {
  const { messages } = input
  const emptyResult: NightOwlAnalysis = {
    nightOwlRank: [],
    lastSpeakerRank: [],
    firstSpeakerRank: [],
    consecutiveRecords: [],
    champions: [],
    totalDays: 0,
  }

  if (messages.length === 0) return emptyResult

  function getNightOwlTitleByCount(count: number): NightOwlTitle {
    if (count === 0) return '养生达人'
    if (count <= 20) return '偶尔失眠'
    if (count <= 50) return '经常失眠'
    if (count <= 100) return '夜猫子'
    if (count <= 200) return '秃头预备役'
    if (count <= 500) return '修仙练习生'
    return '守夜冠军'
  }

  function getAdjustedDate(ts: number): string {
    const date = new Date(ts * 1000)
    const hour = date.getHours()
    if (hour < 5) {
      date.setDate(date.getDate() - 1)
    }
    return date.toISOString().split('T')[0]
  }

  function formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  }

  const memberInfo = new Map<number, { platformId: string; name: string }>()
  const nightStats = new Map<
    number,
    { total: number; h23: number; h0: number; h1: number; h2: number; h3to4: number; totalMessages: number }
  >()
  const dailyMessages = new Map<string, Array<{ senderId: number; ts: number; hour: number; minute: number }>>()
  const memberNightDays = new Map<number, Set<string>>()

  for (const msg of messages) {
    if (!memberInfo.has(msg.senderId)) {
      memberInfo.set(msg.senderId, { platformId: msg.platformId, name: msg.name })
    }

    const date = new Date(msg.ts * 1000)
    const hour = date.getHours()
    const minute = date.getMinutes()
    const adjustedDate = getAdjustedDate(msg.ts)

    if (!nightStats.has(msg.senderId)) {
      nightStats.set(msg.senderId, { total: 0, h23: 0, h0: 0, h1: 0, h2: 0, h3to4: 0, totalMessages: 0 })
    }
    const stats = nightStats.get(msg.senderId)!
    stats.totalMessages++

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

    if (hour >= 23 || hour < 5) {
      if (!memberNightDays.has(msg.senderId)) {
        memberNightDays.set(msg.senderId, new Set())
      }
      memberNightDays.get(msg.senderId)!.add(adjustedDate)
    }

    if (!dailyMessages.has(adjustedDate)) {
      dailyMessages.set(adjustedDate, [])
    }
    dailyMessages.get(adjustedDate)!.push({ senderId: msg.senderId, ts: msg.ts, hour, minute })
  }

  const totalDays = dailyMessages.size

  const nightOwlRank: NightOwlAnalysis['nightOwlRank'] = []
  for (const [memberId, stats] of nightStats.entries()) {
    if (stats.total === 0) continue
    const info = memberInfo.get(memberId)!
    nightOwlRank.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      totalNightMessages: stats.total,
      title: getNightOwlTitleByCount(stats.total),
      hourlyBreakdown: { h23: stats.h23, h0: stats.h0, h1: stats.h1, h2: stats.h2, h3to4: stats.h3to4 },
      percentage: stats.totalMessages > 0 ? Math.round((stats.total / stats.totalMessages) * 10000) / 100 : 0,
    })
  }
  nightOwlRank.sort((a, b) => b.totalNightMessages - a.totalNightMessages)

  const lastSpeakerStats = new Map<number, { count: number; times: number[] }>()
  const firstSpeakerStats = new Map<number, { count: number; times: number[] }>()

  for (const [, dayMessages] of dailyMessages.entries()) {
    if (dayMessages.length === 0) continue
    const lastMsg = dayMessages[dayMessages.length - 1]
    if (!lastSpeakerStats.has(lastMsg.senderId)) {
      lastSpeakerStats.set(lastMsg.senderId, { count: 0, times: [] })
    }
    const lastStats = lastSpeakerStats.get(lastMsg.senderId)!
    lastStats.count++
    lastStats.times.push(lastMsg.hour * 60 + lastMsg.minute)

    const firstMsg = dayMessages[0]
    if (!firstSpeakerStats.has(firstMsg.senderId)) {
      firstSpeakerStats.set(firstMsg.senderId, { count: 0, times: [] })
    }
    const firstStats = firstSpeakerStats.get(firstMsg.senderId)!
    firstStats.count++
    firstStats.times.push(firstMsg.hour * 60 + firstMsg.minute)
  }

  const lastSpeakerRank: Array<{
    memberId: number
    platformId: string
    name: string
    count: number
    avgTime: string
    extremeTime: string
    percentage: number
  }> = []
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

  const firstSpeakerRank: Array<{
    memberId: number
    platformId: string
    name: string
    count: number
    avgTime: string
    extremeTime: string
    percentage: number
  }> = []
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

  const consecutiveRecords: Array<{
    memberId: number
    platformId: string
    name: string
    maxConsecutiveDays: number
    currentStreak: number
  }> = []
  for (const [memberId, nightDaysSet] of memberNightDays.entries()) {
    if (nightDaysSet.size === 0) continue
    const info = memberInfo.get(memberId)!
    const sortedNightDays = Array.from(nightDaysSet).sort()

    let maxStreak = 1
    let currentStreak = 1
    for (let i = 1; i < sortedNightDays.length; i++) {
      const prevDate = new Date(sortedNightDays[i - 1])
      const currDate = new Date(sortedNightDays[i])
      const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      if (diffDays === 1) {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 1
      }
    }

    const lastNightDay = sortedNightDays[sortedNightDays.length - 1]
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const isCurrentStreak = lastNightDay === today || lastNightDay === yesterday

    consecutiveRecords.push({
      memberId,
      platformId: info.platformId,
      name: info.name,
      maxConsecutiveDays: maxStreak,
      currentStreak: isCurrentStreak ? currentStreak : 0,
    })
  }
  consecutiveRecords.sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays)

  const championScores = new Map<number, { nightMessages: number; lastSpeakerCount: number; consecutiveDays: number }>()
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

  const champions: Array<{
    memberId: number
    platformId: string
    name: string
    score: number
    nightMessages: number
    lastSpeakerCount: number
    consecutiveDays: number
  }> = []
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

  return { nightOwlRank, lastSpeakerRank, firstSpeakerRank, consecutiveRecords, champions, totalDays }
}

export async function queryNightOwlAnalysis(sessionId: string, timeFilter?: TimeFilter): Promise<NightOwlAnalysis> {
  const { conditions, params } = buildFilter(timeFilter)

  const messages = await window.chatApi.pluginQuery<{
    id: number
    senderId: number
    ts: number
    platformId: string
    name: string
  }>(
    sessionId,
    `SELECT
      msg.id,
      msg.sender_id as senderId,
      msg.ts,
      m.platform_id as platformId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1 ${SYSTEM_FILTER} ${conditions}
    ORDER BY msg.ts ASC`,
    params
  )

  if (messages.length === 0) {
    return {
      nightOwlRank: [],
      lastSpeakerRank: [],
      firstSpeakerRank: [],
      consecutiveRecords: [],
      champions: [],
      totalDays: 0,
    }
  }

  return window.chatApi.pluginCompute<NightOwlAnalysis>(computeNightOwl.toString(), { messages })
}

// ==================== 复读分析 ====================

function computeRepeat(input: {
  messages: Array<{ id: number; senderId: number; content: string; ts: number; platformId: string; name: string }>
}): RepeatAnalysis {
  const { messages } = input

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

  const fastestRepeaterStats = new Map<number, { totalDiff: number; count: number }>()

  const processRepeatChain = (
    chain: Array<{ id: number; senderId: number; content: string; ts: number }>,
    breakerId?: number
  ) => {
    if (chain.length < 3) return

    totalRepeatChains++
    const chainLength = chain.length
    totalChainLength += chainLength

    const oId = chain[0].senderId
    originatorCount.set(oId, (originatorCount.get(oId) || 0) + 1)

    const iId = chain[1].senderId
    initiatorCount.set(iId, (initiatorCount.get(iId) || 0) + 1)

    if (breakerId !== undefined) {
      breakerCount.set(breakerId, (breakerCount.get(breakerId) || 0) + 1)
    }

    chainLengthCount.set(chainLength, (chainLengthCount.get(chainLength) || 0) + 1)

    const content = chain[0].content
    const chainTs = chain[0].ts
    const firstMsgId = chain[0].id
    const existing = contentStats.get(content)
    if (existing) {
      existing.count++
      existing.lastTs = Math.max(existing.lastTs, chainTs)
      if (chainLength > existing.maxChainLength) {
        existing.maxChainLength = chainLength
        existing.originatorId = oId
        existing.firstMessageId = firstMsgId
      }
    } else {
      contentStats.set(content, {
        count: 1,
        maxChainLength: chainLength,
        originatorId: oId,
        lastTs: chainTs,
        firstMessageId: firstMsgId,
      })
    }

    for (let i = 1; i < chain.length; i++) {
      const currentMsg = chain[i]
      const prevMsg = chain[i - 1]
      const diff = (currentMsg.ts - prevMsg.ts) * 1000
      if (diff <= 20 * 1000) {
        if (!fastestRepeaterStats.has(currentMsg.senderId)) {
          fastestRepeaterStats.set(currentMsg.senderId, { totalDiff: 0, count: 0 })
        }
        const stats = fastestRepeaterStats.get(currentMsg.senderId)!
        stats.totalDiff += diff
        stats.count++
      }
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

  const buildRankList = (countMap: Map<number, number>, total: number): any[] => {
    const items: any[] = []
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

  const buildRateList = (countMap: Map<number, number>): any[] => {
    const items: any[] = []
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

  const buildFastestList = (): any[] => {
    const items: any[] = []
    for (const [memberId, stats] of fastestRepeaterStats.entries()) {
      if (stats.count < 5) continue
      const info = memberInfo.get(memberId)
      if (info) {
        items.push({
          memberId,
          platformId: info.platformId,
          name: info.name,
          count: stats.count,
          avgTimeDiff: Math.round(stats.totalDiff / stats.count),
        })
      }
    }
    return items.sort((a, b) => a.avgTimeDiff - b.avgTimeDiff)
  }

  const chainLengthDistribution: any[] = []
  for (const [length, count] of chainLengthCount.entries()) {
    chainLengthDistribution.push({ length, count })
  }
  chainLengthDistribution.sort((a, b) => a.length - b.length)

  const hotContents: any[] = []
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
  const top50HotContents = hotContents.slice(0, 100)

  return {
    originators: buildRankList(originatorCount, totalRepeatChains),
    initiators: buildRankList(initiatorCount, totalRepeatChains),
    breakers: buildRankList(breakerCount, totalRepeatChains),
    fastestRepeaters: buildFastestList(),
    originatorRates: buildRateList(originatorCount),
    initiatorRates: buildRateList(initiatorCount),
    breakerRates: buildRateList(breakerCount),
    chainLengthDistribution,
    hotContents: top50HotContents,
    avgChainLength: totalRepeatChains > 0 ? Math.round((totalChainLength / totalRepeatChains) * 100) / 100 : 0,
    totalRepeatChains,
  }
}

export async function queryRepeatAnalysis(sessionId: string, timeFilter?: TimeFilter): Promise<RepeatAnalysis> {
  const { conditions, params } = buildFilter(timeFilter)

  const messages = await window.chatApi.pluginQuery<{
    id: number
    senderId: number
    content: string
    ts: number
    platformId: string
    name: string
  }>(
    sessionId,
    `SELECT
      msg.id,
      msg.sender_id as senderId,
      msg.content,
      msg.ts,
      m.platform_id as platformId,
      COALESCE(m.group_nickname, m.account_name, m.platform_id) as name
    FROM message msg
    JOIN member m ON msg.sender_id = m.id
    WHERE 1=1 ${SYSTEM_FILTER}
      AND msg.type = 0
      AND msg.content IS NOT NULL
      AND TRIM(msg.content) != ''
      ${conditions}
    ORDER BY msg.ts ASC, msg.id ASC`,
    params
  )

  if (messages.length === 0) {
    return {
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
  }

  return window.chatApi.pluginCompute<RepeatAnalysis>(computeRepeat.toString(), { messages })
}
