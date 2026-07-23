import {
  createWebRuntimeClient,
  type RuntimeLogEvent,
  type WebRuntimeRpcClientOptions,
  type WebRuntimeWorkspaceChangeEvent,
} from '@openchatlab/web-runtime'
import { reportRuntimeLog } from '@/services/log-report'
import { BrowserRuntimeAdapter } from './browser'
import type { BrowserRuntimeRpcPort } from './types'
import { BrowserImportAdapter } from '../import/browser'
import { createBrowserDataAdapter } from '../data/browser'
import { BrowserPlatformAdapter } from '../platform/browser'
import { BrowserPreferencesAdapter } from '../preferences/browser'

export interface RegisterWebWasmAdaptersOptions {
  register(key: string, adapter: unknown): void
  createClient?: (options: WebRuntimeRpcClientOptions) => BrowserRuntimeRpcPort
  reportLog?: (event: RuntimeLogEvent) => void
  onWorkspaceChanged?: (event: WebRuntimeWorkspaceChangeEvent) => void
}

export function registerWebWasmAdapters(options: RegisterWebWasmAdaptersOptions): void {
  const reportLog = options.reportLog ?? reportRuntimeLog
  const createClient = options.createClient ?? createWebRuntimeClient
  const client = createClient({ onLog: reportLog, onWorkspaceChanged: options.onWorkspaceChanged })

  options.register('browser-runtime', new BrowserRuntimeAdapter(client))
  options.register('import', new BrowserImportAdapter(client))
  options.register('data', createBrowserDataAdapter(client))
  options.register('platform', new BrowserPlatformAdapter())
  options.register('preferences', new BrowserPreferencesAdapter())
}
