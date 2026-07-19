import type {
  BrowserCapabilityReport,
  OpenDatabaseResult,
  RpcRequestOptions,
  WebRuntimeRpcClient,
} from '@openchatlab/web-runtime'

export type BrowserRuntimeRpcPort = Pick<WebRuntimeRpcClient, 'request' | 'dispose'>

export interface BrowserRuntimeServiceAdapter {
  checkCapabilities(options?: RpcRequestOptions): Promise<BrowserCapabilityReport>
  openDatabase(filename: string, options?: RpcRequestOptions): Promise<OpenDatabaseResult>
  closeDatabase(options?: RpcRequestOptions): Promise<{ closed: boolean }>
  dispose(): void
}
