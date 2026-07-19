/**
 * Service Registry — 平台检测与 Adapter 实例管理
 *
 * 应用启动时调用 initServices()，根据运行平台创建并注册
 * 各领域 Adapter。各 useXxxService() composable 通过
 * getAdapter<T>(key) 获取已注册的实例。
 */

import { IS_ELECTRON, IS_WEB_WASM } from '@/utils/platform'
import { fetchWithAuth } from './utils/http'

export type Platform = 'electron' | 'cli-web' | 'web-wasm'

export interface PlatformFlags {
  isElectron: boolean
  isWebWasm: boolean
}

interface ServiceAdapterRegistrar {
  register(key: string, adapter: unknown): void
}

export interface InitServicesOptions {
  initializeWebWasm?: (registry: ServiceAdapterRegistrar) => void | Promise<void>
}

export function detectPlatform(flags: PlatformFlags = { isElectron: IS_ELECTRON, isWebWasm: IS_WEB_WASM }): Platform {
  if (flags.isElectron) return 'electron'
  if (flags.isWebWasm) return 'web-wasm'
  return 'cli-web'
}

const adapters = new Map<string, unknown>()
let _initialized = false

export function registerAdapter<T>(key: string, instance: T): void {
  adapters.set(key, instance)
}

export function getRegisteredAdapter<T>(key: string): T {
  const adapter = adapters.get(key)
  if (!adapter) {
    throw new Error(`[services] Adapter "${key}" not registered. Call initServices() first.`)
  }
  return adapter as T
}

export function isInitialized(): boolean {
  return _initialized
}

/**
 * 初始化所有 Service Adapter。
 * 应用启动时调用一次（App.vue 或 main.ts）。
 */
export async function initServices(options: InitServicesOptions = {}): Promise<void> {
  if (_initialized) return

  // Keep compile-time flags in this branch so each build drops adapters for
  // the other platforms instead of shipping their runtime dependencies.
  if (IS_WEB_WASM) {
    await initializeWebWasmServices(options.initializeWebWasm)
  } else if (IS_ELECTRON) {
    await initElectronAdapters()
  } else {
    await initCliWebAdapters()
  }

  _initialized = true
}

export async function initializeWebWasmServices(initialize: InitServicesOptions['initializeWebWasm']): Promise<void> {
  if (!initialize) {
    throw new Error('[services] Web WASM initializer is required')
  }
  await initialize({ register: registerAdapter })
}

/**
 * Electron adapters: Internal HTTP Server is a hard dependency.
 * data/message/preferences/ai-streaming use Fetch/SSE; import stays on IPC.
 */
async function initElectronAdapters(): Promise<void> {
  const { FetchDataAdapter } = await import('./data/fetch')
  registerAdapter('data', new FetchDataAdapter())

  const { ElectronImportAdapter } = await import('./import/electron')
  registerAdapter('import', new ElectronImportAdapter())

  const { FetchSessionIndexAdapter } = await import('./session-index/fetch')
  registerAdapter('session-index', new FetchSessionIndexAdapter())

  const { FetchMessageAdapter } = await import('./message/fetch')
  registerAdapter('message', new FetchMessageAdapter())

  const { ElectronPlatformAdapter } = await import('./platform/electron')
  registerAdapter('platform', new ElectronPlatformAdapter())

  const { ElectronAIAdapter } = await import('./ai/electron')
  registerAdapter('ai', new ElectronAIAdapter())

  const { FetchPreferencesAdapter } = await import('./preferences/fetch')
  registerAdapter('preferences', new FetchPreferencesAdapter())

  const { FetchLLMAdapter } = await import('./llm/fetch')
  registerAdapter('llm', new FetchLLMAdapter())

  const { FetchAssistantAdapter } = await import('./assistant/fetch')
  registerAdapter('assistant-crud', new FetchAssistantAdapter())

  const { FetchSkillAdapter } = await import('./skill/fetch')
  registerAdapter('skill-crud', new FetchSkillAdapter())

  const { FetchCacheAdapter } = await import('./cache/fetch')
  registerAdapter('cache', new FetchCacheAdapter())

  installMergeShims('electron')
}

async function initCliWebAdapters(): Promise<void> {
  const { FetchDataAdapter } = await import('./data/fetch')
  registerAdapter('data', new FetchDataAdapter())

  const { FetchImportAdapter } = await import('./import/fetch')
  registerAdapter('import', new FetchImportAdapter())

  const { FetchSessionIndexAdapter } = await import('./session-index/fetch')
  registerAdapter('session-index', new FetchSessionIndexAdapter())

  const { FetchMessageAdapter } = await import('./message/fetch')
  registerAdapter('message', new FetchMessageAdapter())

  const { CliWebPlatformAdapter } = await import('./platform/cli-web')
  registerAdapter('platform', new CliWebPlatformAdapter())

  const { FetchAIAdapter } = await import('./ai/fetch')
  registerAdapter('ai', new FetchAIAdapter())

  const { FetchPreferencesAdapter } = await import('./preferences/fetch')
  registerAdapter('preferences', new FetchPreferencesAdapter())

  const { FetchLLMAdapter } = await import('./llm/fetch')
  registerAdapter('llm', new FetchLLMAdapter())

  const { FetchAssistantAdapter } = await import('./assistant/fetch')
  registerAdapter('assistant-crud', new FetchAssistantAdapter())

  const { FetchSkillAdapter } = await import('./skill/fetch')
  registerAdapter('skill-crud', new FetchSkillAdapter())

  const { FetchCacheAdapter } = await import('./cache/fetch')
  registerAdapter('cache', new FetchCacheAdapter())

  await installCliWebShims()
}

/**
 * Install remaining window shims for CLI Web.
 * AI streaming shims have been removed — the service layer now
 * uses fetchSSE directly via useAgentStreamService/useLlmStreamService.
 */
async function installCliWebShims(): Promise<void> {
  installMergeShims('cli-web')
}

/**
 * Install merge-related window shims.
 *
 * Both Electron and CLI Web use the same HTTP merge routes. The shim
 * maintains a filePath→handle Map so that existing frontend code
 * (session.ts, BatchManageTab.vue) can continue calling with filePaths
 * while the HTTP layer operates with UUID handles.
 */
function installMergeShims(platform: 'electron' | 'cli-web'): void {
  const pathToHandle = new Map<string, string>()

  const isHandle = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

  const resolveHandle = (filePathOrHandle: string) => pathToHandle.get(filePathOrHandle) ?? filePathOrHandle

  async function ensureOk(resp: Response, context: string): Promise<void> {
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`[mergeApi] ${context} failed (${resp.status}): ${body}`)
    }
  }

  ;(window as any).mergeApi = {
    exportSessionsToTempFiles: async (sessionIds: string[]) => {
      try {
        const resp = await fetchWithAuth('/_web/sessions/export-for-merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionIds }),
        })
        await ensureOk(resp, 'exportSessionsToTempFiles')
        const result = await resp.json()
        if (!result.success) return { success: false, tempFiles: [], error: result.error }
        const tempFiles = result.handles.map((h: { handle: string }) => h.handle)
        return { success: true, tempFiles }
      } catch (error) {
        return { success: false, tempFiles: [], error: error instanceof Error ? error.message : String(error) }
      }
    },

    cleanupTempExportFiles: async (filePaths: string[]) => {
      try {
        for (const fp of filePaths) {
          const handle = resolveHandle(fp)
          await fetchWithAuth('/_web/merge/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle }),
          })
          pathToHandle.delete(fp)
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    parseFileInfo: async (filePath: string) => {
      if (isHandle(filePath) || pathToHandle.has(filePath)) {
        return { name: '', format: '', platform: '', messageCount: 0, memberCount: 0, fileSize: 0 }
      }

      if (platform === 'electron') {
        const resp = await fetchWithAuth('/_web/merge/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
        })
        await ensureOk(resp, 'parseFileInfo')
        const result = await resp.json()
        if (!result.handle) throw new Error('Parse succeeded but no handle returned')
        pathToHandle.set(filePath, result.handle)
        return result
      }

      return { name: '', format: '', platform: '', messageCount: 0, memberCount: 0, fileSize: 0 }
    },

    checkConflicts: async (filePaths: string[]) => {
      const handles = filePaths.map(resolveHandle)
      const resp = await fetchWithAuth('/_web/merge/conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles }),
      })
      await ensureOk(resp, 'checkConflicts')
      return await resp.json()
    },

    mergeFiles: async (params: {
      filePaths: string[]
      outputName: string
      outputFormat?: string
      andAnalyze?: boolean
    }) => {
      try {
        const handles = params.filePaths.map(resolveHandle)
        const resp = await fetchWithAuth('/_web/merge/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handles,
            outputName: params.outputName,
            format: params.outputFormat || 'json',
            andImport: params.andAnalyze ?? false,
          }),
        })
        await ensureOk(resp, 'mergeFiles')
        const result = await resp.json()
        for (const fp of params.filePaths) pathToHandle.delete(fp)
        return result
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    clearCache: async (filePath?: string) => {
      try {
        const handle = filePath ? resolveHandle(filePath) : undefined
        await fetchWithAuth('/_web/merge/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle }),
        })
        if (filePath) {
          pathToHandle.delete(filePath)
        } else {
          pathToHandle.clear()
        }
        return true
      } catch {
        return false
      }
    },
  }
}
