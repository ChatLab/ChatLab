import { getRegisteredAdapter } from '../registry'
import type { BrowserRuntimeServiceAdapter } from './types'

export function useBrowserRuntimeService(): BrowserRuntimeServiceAdapter {
  return getRegisteredAdapter<BrowserRuntimeServiceAdapter>('browser-runtime')
}
