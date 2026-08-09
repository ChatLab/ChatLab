export type ChatTopicRangeKind = 'today' | 'year' | 'custom' | 'all'

export type ChatTopicRunRangeKind = ChatTopicRangeKind | 'day'

export type ChatTopicRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type ChatTopicDayStatus = 'pending' | 'running' | 'ready' | 'stale' | 'failed'

export interface ChatTopicTimeRange {
  startTs: number
  endTs: number
}

export interface ChatTopicEvidence {
  messageId: number
  timestamp: number
  role: 'primary' | 'supporting' | 'counter'
}

export type ChatTopicAssignmentMode = 'exact' | 'range'

export interface ChatTopic {
  id: string
  title: string
  summary: string
  participants: string[]
  timeRanges: ChatTopicTimeRange[]
  /** 完整话题成员消息；旧快照可能仅有代表证据。 */
  messageIds: number[]
  /** exact 表示逐条消息归属，range 表示旧快照只能按时间范围兼容。 */
  assignmentMode: ChatTopicAssignmentMode
  state: 'active' | 'closed'
  evidence: ChatTopicEvidence[]
}

export interface ChatTopicDay {
  sessionId: string
  dayKey: string
  timezone: string
  status: ChatTopicDayStatus
  overview: string | null
  sourceSignature: string
  sourceMessageCount: number
  sourceFirstTs: number
  sourceLastTs: number
  modelId: string | null
  promptVersion: string
  algorithmVersion: string
  generatedAt: number | null
  updatedAt: number
  lastError: string | null
  topics: ChatTopic[]
}

export interface ChatTopicPreflightDay {
  dayKey: string
  messageCount: number
  estimatedChars: number
  estimatedBlocks: number
  firstTs: number
  lastTs: number
}

export interface ChatTopicPreflight {
  sessionId: string
  rangeKind: ChatTopicRangeKind
  timezone: string
  startDay: string
  endDay: string
  activeDays: number
  messageCount: number
  estimatedBlocks: number
  estimatedCalls: number
  days: ChatTopicPreflightDay[]
}

export interface ChatTopicRun {
  id: string
  sessionId: string
  rangeKind: ChatTopicRunRangeKind
  timezone: string
  locale: string | null
  startDay: string
  endDay: string
  status: ChatTopicRunStatus
  totalDays: number
  completedDays: number
  totalBlocks: number
  completedBlocks: number
  currentDay: string | null
  currentBlockIndex: number | null
  modelId: string | null
  promptVersion: string
  algorithmVersion: string
  inputTokens: number
  outputTokens: number
  modelCalls: number
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface CreateChatTopicsRequest {
  rangeKind: ChatTopicRangeKind
  timezone: string
  locale?: string
  startDay?: string
}
