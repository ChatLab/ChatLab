import { getRegisteredAdapter } from '../registry'
import type { BrowserRuntimeServiceAdapter } from './types'
import type { BrowserRuntimeRpcPort } from './types'

export function useBrowserRuntimeService(): BrowserRuntimeServiceAdapter {
  return getRegisteredAdapter<BrowserRuntimeServiceAdapter>('browser-runtime')
}

export function useBrowserRuntimeRpc(): BrowserRuntimeRpcPort {
  return getRegisteredAdapter<BrowserRuntimeRpcPort>('browser-runtime-rpc')
}
