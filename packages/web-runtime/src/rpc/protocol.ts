import type { BrowserImportFormatId, BrowserParseSource } from '../import/browser-parser'
import type { BrowserSessionCatalogItem } from '../import/session-catalog'
import type {
  DailyActivity,
  HourlyActivity,
  MemberActivity,
  MemberMonthlyTrend,
  MemberWithAliases,
  MessageLengthDistribution,
  MessageTypeStats,
  MentionGraphData,
  MonthlyActivity,
  ClusterGraphData,
  ClusterGraphOptions,
  JourneyStats,
  RelationshipStats,
  TextLengthPercentiles,
  TextStats,
  WeekdayActivity,
  WordFrequencyParams,
  WordFrequencyResult,
  YearlyActivity,
} from '@openchatlab/core'
import type {
  BrowserImportFormatInfo,
  BrowserMultiChatEntry,
  BrowserSessionImportResult,
  BrowserTimeFilter,
} from '../import/session-runtime'

export interface BrowserCapabilities {
  webAssembly: boolean
  dedicatedWorker: boolean
  opfs: boolean
  storageEstimate: boolean
  secureContext: boolean
}

export interface BrowserCapabilityReport {
  supported: boolean
  missing: Array<keyof BrowserCapabilities>
  capabilities: BrowserCapabilities
}

export interface OpenDatabaseResult {
  filename: string
  sqliteVersion: string
  schemaVersion: number
}

export interface WebRuntimeTaskMap {
  'capabilities.check': {
    payload: undefined
    result: BrowserCapabilityReport
  }
  'db.open': {
    payload: { filename: string }
    result: OpenDatabaseResult
  }
  'db.close': {
    payload: undefined
    result: { closed: boolean }
  }
  'import.formats': {
    payload: undefined
    result: BrowserImportFormatInfo[]
  }
  'import.detectFormat': {
    payload: { source: BrowserParseSource }
    result: BrowserImportFormatInfo | null
  }
  'import.scanChats': {
    payload: { source: BrowserParseSource }
    result: BrowserMultiChatEntry[]
  }
  'import.start': {
    payload: { source: BrowserParseSource; formatId?: BrowserImportFormatId; chatIndex?: number }
    result: BrowserSessionImportResult
  }
  'session.list': {
    payload: undefined
    result: BrowserSessionCatalogItem[]
  }
  'session.get': {
    payload: { sessionId: string }
    result: BrowserSessionCatalogItem | null
  }
  'session.delete': {
    payload: { sessionId: string }
    result: { deleted: boolean }
  }
  'session.rename': {
    payload: { sessionId: string; name: string }
    result: { renamed: boolean }
  }
  'analysis.hourly': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: HourlyActivity[]
  }
  'analysis.daily': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: DailyActivity[]
  }
  'analysis.weekday': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: WeekdayActivity[]
  }
  'analysis.timeRange': {
    payload: { sessionId: string }
    result: { start: number; end: number } | null
  }
  'analysis.availableYears': {
    payload: { sessionId: string }
    result: number[]
  }
  'analysis.members': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MemberActivity[]
  }
  'analysis.messageTypes': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MessageTypeStats[]
  }
  'analysis.messageLengths': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MessageLengthDistribution
  }
  'analysis.textStats': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: TextStats
  }
  'analysis.longMessages': {
    payload: { sessionId: string; filter?: BrowserTimeFilter; minLength?: number }
    result: number
  }
  'analysis.textPercentiles': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: TextLengthPercentiles
  }
  'analysis.monthly': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MonthlyActivity[]
  }
  'analysis.yearly': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: YearlyActivity[]
  }
  'analysis.memberMonthlyTrend': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MemberMonthlyTrend[]
  }
  'analysis.memberList': {
    payload: { sessionId: string }
    result: MemberWithAliases[]
  }
  'analysis.mentions': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: {
      topMentioners: Array<{ memberId: number; platformId: string; name: string; count: number; percentage: number }>
      topMentioned: Array<{ memberId: number; platformId: string; name: string; count: number; percentage: number }>
      totalMentions: number
    }
  }
  'analysis.mentionGraph': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MentionGraphData
  }
  'analysis.clusterGraph': {
    payload: { sessionId: string; filter?: BrowserTimeFilter; options?: ClusterGraphOptions }
    result: ClusterGraphData
  }
  'analysis.relationship': {
    payload: { sessionId: string; filter?: BrowserTimeFilter; options?: { perseveranceThreshold?: number } }
    result: RelationshipStats
  }
  'analysis.journey': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: JourneyStats
  }
  'analysis.languagePreference': {
    payload: { sessionId: string; locale: string; filter?: BrowserTimeFilter }
    result: unknown
  }
  'analysis.wordFrequency': {
    payload: { sessionId: string; params: Omit<WordFrequencyParams, 'sessionId'> }
    result: WordFrequencyResult
  }
}

export type WebRuntimeTaskType = keyof WebRuntimeTaskMap
export type WebRuntimeTaskPayload<T extends WebRuntimeTaskType> = WebRuntimeTaskMap[T]['payload']
export type WebRuntimeTaskResult<T extends WebRuntimeTaskType> = WebRuntimeTaskMap[T]['result']

export type RpcRequestEnvelope<T extends WebRuntimeTaskType = WebRuntimeTaskType> = T extends WebRuntimeTaskType
  ? {
      id: string
      type: T
      payload: WebRuntimeTaskPayload<T>
    }
  : never

export interface RpcCancelEnvelope {
  id: string
  type: 'cancel'
  payload: { reason?: string }
}

export type RpcWorkerRequestEnvelope = RpcRequestEnvelope | RpcCancelEnvelope

export interface RpcProgressPayload {
  taskType: WebRuntimeTaskType
  stage: string
  progress?: number
  message?: string
  messagesProcessed?: number
}

export interface SerializedRpcError {
  name: string
  code: string
  message: string
  stack?: string
}

export interface RuntimeLogEvent {
  level: 'debug' | 'info' | 'error'
  scope: 'web-runtime'
  message: string
  data?: Record<string, unknown>
}

export interface WebRuntimeWorkspaceChangeEvent {
  type: 'import' | 'delete' | 'rename'
  sessionId: string
}

export interface RpcProgressEnvelope {
  id: string
  type: 'progress'
  payload: RpcProgressPayload
}

export interface RpcResultEnvelope {
  id: string
  type: 'result'
  payload: {
    taskType: WebRuntimeTaskType
    result: WebRuntimeTaskResult<WebRuntimeTaskType>
  }
}

export interface RpcErrorEnvelope {
  id: string
  type: 'error'
  payload: {
    taskType: WebRuntimeTaskType
    error: SerializedRpcError
  }
}

export interface RpcLogEnvelope {
  id: string
  type: 'log'
  payload: RuntimeLogEvent
}

export type RpcResponseEnvelope = RpcProgressEnvelope | RpcResultEnvelope | RpcErrorEnvelope | RpcLogEnvelope

export function isRpcWorkerRequestEnvelope(value: unknown): value is RpcWorkerRequestEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<RpcWorkerRequestEnvelope>
  if (typeof envelope.id !== 'string' || typeof envelope.type !== 'string' || !('payload' in envelope)) return false
  return envelope.type === 'cancel' || Object.prototype.hasOwnProperty.call(WEB_RUNTIME_TASK_TYPES, envelope.type)
}

const WEB_RUNTIME_TASK_TYPES: Record<WebRuntimeTaskType, true> = {
  'capabilities.check': true,
  'db.open': true,
  'db.close': true,
  'import.formats': true,
  'import.detectFormat': true,
  'import.scanChats': true,
  'import.start': true,
  'session.list': true,
  'session.get': true,
  'session.delete': true,
  'session.rename': true,
  'analysis.hourly': true,
  'analysis.daily': true,
  'analysis.weekday': true,
  'analysis.timeRange': true,
  'analysis.availableYears': true,
  'analysis.members': true,
  'analysis.messageTypes': true,
  'analysis.messageLengths': true,
  'analysis.textStats': true,
  'analysis.longMessages': true,
  'analysis.textPercentiles': true,
  'analysis.monthly': true,
  'analysis.yearly': true,
  'analysis.memberMonthlyTrend': true,
  'analysis.memberList': true,
  'analysis.mentions': true,
  'analysis.mentionGraph': true,
  'analysis.clusterGraph': true,
  'analysis.relationship': true,
  'analysis.journey': true,
  'analysis.languagePreference': true,
  'analysis.wordFrequency': true,
}
