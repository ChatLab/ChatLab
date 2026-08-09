import { createHash } from 'node:crypto'
import { getSessionMeta, getSessionOverview, type DatabaseAdapter } from '@openchatlab/core'
import type { ChatTopicPreflight, ChatTopicPreflightDay, ChatTopicRangeKind } from '@openchatlab/shared-types'
import type { SessionRuntimeAdapter } from '../adapters'
import {
  assertValidTopicDayKey,
  enumerateTopicDays,
  formatTopicDayKey,
  getTopicDayRange,
  startOfTopicYear,
} from './time'

export const TOPIC_BLOCK_MAX_MESSAGES = 160
export const TOPIC_BLOCK_MAX_CHARS = 8_000

export type TopicChatType = 'group' | 'private'

export interface TopicSourceMessage {
  id: number
  senderName: string
  timestamp: number
  type: number
  content: string
}

export interface TopicSourceBlock {
  index: number
  messages: TopicSourceMessage[]
  estimatedChars: number
}

export interface TopicSourceDay {
  chatType: TopicChatType
  dayKey: string
  timezone: string
  startTs: number
  endTs: number
  sourceSignature: string
  messages: TopicSourceMessage[]
  blocks: TopicSourceBlock[]
}

interface SourceRow {
  id: number
  senderName: string
  timestamp: number
  type: number
  content: string | null
}

interface DayStatsRow {
  messageCount: number
  estimatedChars: number | null
  firstTs: number | null
  lastTs: number | null
}

export function getTopicChatType(db: DatabaseAdapter): TopicChatType {
  const meta = getSessionMeta(db)
  if (!meta) throw Object.assign(new Error('Session metadata is missing'), { statusCode: 404 })
  if (meta.type !== 'group' && meta.type !== 'private') {
    throw Object.assign(new Error(`Unsupported chat type for topics: ${meta.type}`), { statusCode: 400 })
  }
  return meta.type
}

export function loadTopicSourceDay(db: DatabaseAdapter, dayKey: string, timezone: string): TopicSourceDay {
  const chatType = getTopicChatType(db)
  const range = getTopicDayRange(dayKey, timezone)
  const rows = db
    .prepare(
      `SELECT msg.id,
        COALESCE(member.group_nickname, member.account_name, member.platform_id) AS senderName,
        msg.ts AS timestamp, msg.type, msg.content
       FROM message msg
       JOIN member ON member.id = msg.sender_id
       WHERE msg.ts >= ? AND msg.ts < ?
       ORDER BY msg.ts ASC, msg.id ASC`
    )
    .all(range.startTs, range.endTs) as unknown as SourceRow[]
  const messages = rows.map(normalizeSourceRow)
  return {
    chatType,
    ...range,
    timezone,
    sourceSignature: createTopicSourceSignature(messages, chatType),
    messages,
    blocks: chunkTopicMessages(messages),
  }
}

export function createTopicPreflight(
  runtime: SessionRuntimeAdapter,
  sessionId: string,
  rangeKind: ChatTopicRangeKind,
  timezone: string,
  nowSeconds: number,
  requestedStartDay?: string
): ChatTopicPreflight {
  const db = runtime.ensureReadonly(sessionId)
  getTopicChatType(db)
  const overview = getSessionOverview(db)
  const today = formatTopicDayKey(nowSeconds, timezone)
  const firstDay = overview.firstMessageTs == null ? today : formatTopicDayKey(overview.firstMessageTs, timezone)
  const dataEndDay = overview.lastMessageTs == null ? today : formatTopicDayKey(overview.lastMessageTs, timezone)
  const lastAvailableDay = dataEndDay < today ? dataEndDay : today
  let startDay: string
  if (rangeKind === 'all') {
    startDay = firstDay
  } else if (rangeKind === 'year') {
    startDay = startOfTopicYear(today)
  } else if (rangeKind === 'custom') {
    if (!requestedStartDay) {
      throw Object.assign(new Error('A start day is required for a custom topic range'), { statusCode: 400 })
    }
    assertValidTopicDayKey(requestedStartDay)
    startDay = requestedStartDay < firstDay ? firstDay : requestedStartDay
  } else {
    startDay = today
  }
  const endDay = rangeKind === 'today' ? today : lastAvailableDay
  const dayKeys = startDay <= endDay ? enumerateTopicDays(startDay, endDay) : []
  const days = dayKeys.map((dayKey) => readTopicDayStats(db, dayKey, timezone)).filter((day) => day.messageCount > 0)

  return {
    sessionId,
    rangeKind,
    timezone,
    startDay,
    endDay,
    activeDays: days.length,
    messageCount: days.reduce((sum, day) => sum + day.messageCount, 0),
    estimatedBlocks: days.reduce((sum, day) => sum + day.estimatedBlocks, 0),
    // 每个消息块一次增量归纳；每天再调用一次，完成日级收束。
    estimatedCalls: days.reduce((sum, day) => sum + day.estimatedBlocks + 1, 0),
    days,
  }
}

export function createTopicSourceSignature(messages: TopicSourceMessage[], chatType: TopicChatType): string {
  const hash = createHash('sha256')
  hash.update(`${chatType}\u0000`)
  for (const message of messages) {
    hash.update(
      `${message.id}\u0000${message.timestamp}\u0000${message.type}\u0000${message.senderName}\u0000${message.content}\u0000`
    )
  }
  return hash.digest('hex')
}

export function chunkTopicMessages(messages: TopicSourceMessage[]): TopicSourceBlock[] {
  const blocks: TopicSourceBlock[] = []
  let current: TopicSourceMessage[] = []
  let currentChars = 0

  const flush = () => {
    if (current.length === 0) return
    blocks.push({ index: blocks.length, messages: current, estimatedChars: currentChars })
    current = []
    currentChars = 0
  }

  for (const message of messages) {
    const messageChars = estimateMessageChars(message)
    if (
      current.length > 0 &&
      (current.length >= TOPIC_BLOCK_MAX_MESSAGES || currentChars + messageChars > TOPIC_BLOCK_MAX_CHARS)
    ) {
      flush()
    }
    current.push(message)
    currentChars += messageChars
  }
  flush()
  return blocks
}

function readTopicDayStats(db: DatabaseAdapter, dayKey: string, timezone: string): ChatTopicPreflightDay {
  const range = getTopicDayRange(dayKey, timezone)
  const row = db
    .prepare(
      `SELECT COUNT(*) AS messageCount,
        SUM(LENGTH(COALESCE(msg.content, '')) + LENGTH(COALESCE(member.group_nickname, member.account_name, member.platform_id, '')) + 40) AS estimatedChars,
        MIN(msg.ts) AS firstTs, MAX(msg.ts) AS lastTs
       FROM message msg
       JOIN member ON member.id = msg.sender_id
       WHERE msg.ts >= ? AND msg.ts < ?`
    )
    .get(range.startTs, range.endTs) as DayStatsRow | undefined
  const messageCount = Number(row?.messageCount ?? 0)
  const estimatedChars = Number(row?.estimatedChars ?? 0)
  return {
    dayKey,
    messageCount,
    estimatedChars,
    estimatedBlocks:
      messageCount === 0
        ? 0
        : Math.max(
            Math.ceil(messageCount / TOPIC_BLOCK_MAX_MESSAGES),
            Math.ceil(estimatedChars / TOPIC_BLOCK_MAX_CHARS)
          ),
    firstTs: Number(row?.firstTs ?? range.startTs),
    lastTs: Number(row?.lastTs ?? range.startTs),
  }
}

function normalizeSourceRow(row: SourceRow): TopicSourceMessage {
  return {
    id: Number(row.id),
    senderName: String(row.senderName || ''),
    timestamp: Number(row.timestamp),
    type: Number(row.type),
    content: row.content == null || row.content === '' ? `[非文本消息，类型 ${row.type}]` : String(row.content),
  }
}

function estimateMessageChars(message: TopicSourceMessage): number {
  return message.senderName.length + message.content.length + 40
}
