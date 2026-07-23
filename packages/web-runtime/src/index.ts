import { WebRuntimeRpcClient, type WebRuntimeRpcClientOptions } from './rpc/client'

export { WebRuntimeRpcClient, WebRuntimeRpcError } from './rpc/client'
export type { RpcRequestOptions, RpcWorker, WebRuntimeRpcClientOptions } from './rpc/client'
export type {
  BrowserCapabilities,
  BrowserCapabilityReport,
  OpenDatabaseResult,
  RpcProgressPayload,
  RuntimeLogEvent,
  WebRuntimeWorkspaceChangeEvent,
  WebRuntimeTaskMap,
  WebRuntimeTaskPayload,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from './rpc/protocol'
export type { BrowserImportFormatId, BrowserParseSource } from './import/browser-parser'
export type { BrowserSessionCatalogItem } from './import/session-catalog'
export type {
  BrowserImportFormatInfo,
  BrowserImportProgress,
  BrowserMultiChatEntry,
  BrowserSessionImportResult,
  BrowserTimeFilter,
} from './import/session-runtime'
export { sessionDatabaseFilename } from './import/session-runtime'

export function createWebRuntimeClient(options: WebRuntimeRpcClientOptions = {}): WebRuntimeRpcClient {
  if (typeof Worker !== 'function') {
    throw new Error('Web Workers are not available in this browser')
  }
  return new WebRuntimeRpcClient(
    () => new Worker(new URL('./worker/index.ts', import.meta.url), { type: 'module', name: 'chatlab-web-runtime' }),
    options
  )
}
