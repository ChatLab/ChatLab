import type { BrowserImportFormatId, BrowserParseSource } from '../import/browser-parser'
import type { BrowserSessionCatalogItem } from '../import/session-catalog'
import type { HourlyActivity, MemberActivity, MessageTypeStats } from '@openchatlab/core'
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
  'analysis.members': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MemberActivity[]
  }
  'analysis.messageTypes': {
    payload: { sessionId: string; filter?: BrowserTimeFilter }
    result: MessageTypeStats[]
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
  'analysis.members': true,
  'analysis.messageTypes': true,
}
