import type { BrowserRuntimeRpcPort, BrowserRuntimeServiceAdapter } from './types'
import type { BrowserCapabilityReport, OpenDatabaseResult, RpcRequestOptions } from '@openchatlab/web-runtime'

export class BrowserRuntimeAdapter implements BrowserRuntimeServiceAdapter {
  constructor(private readonly rpc: BrowserRuntimeRpcPort) {}

  checkCapabilities(options: RpcRequestOptions = {}): Promise<BrowserCapabilityReport> {
    return this.rpc.request('capabilities.check', undefined, options)
  }

  openDatabase(filename: string, options: RpcRequestOptions = {}): Promise<OpenDatabaseResult> {
    return this.rpc.request('db.open', { filename }, options)
  }

  closeDatabase(options: RpcRequestOptions = {}): Promise<{ closed: boolean }> {
    return this.rpc.request('db.close', undefined, options)
  }

  dispose(): void {
    this.rpc.dispose()
  }
}
