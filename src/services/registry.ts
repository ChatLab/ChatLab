/**
 * Service Registry — 平台检测与 Adapter 实例管理
 *
 * 应用启动时调用 initServices()，根据运行平台创建并注册
 * 各领域 Adapter。各 useXxxService() composable 通过
 * getAdapter<T>(key) 获取已注册的实例。
 */

import { IS_ELECTRON, IS_BROWSER_STANDALONE } from '@/utils/platform'
import { fetchWithAuth } from './utils/http'

export type Platform = 'electron' | 'web-serve' | 'web-browser'

export function detectPlatform(): Platform {
  if (IS_ELECTRON) return 'electron'
  if (IS_BROWSER_STANDALONE) return 'web-browser'
  return 'web-serve'
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
export async function initServices(): Promise<void> {
  if (_initialized) return

  const platform = detectPlatform()

  switch (platform) {
    case 'electron':
      await initElectronAdapters()
      break
    case 'web-serve':
      await initWebServeAdapters()
      break
    case 'web-browser':
      await initWebBrowserAdapters()
      break
  }

  _initialized = true
}

/**
 * Electron adapters: Internal HTTP Server is a hard dependency.
 * data/message/preferences use Fetch; import/session-index/ai stay on IPC.
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
}

async function initWebServeAdapters(): Promise<void> {
  const { FetchDataAdapter } = await import('./data/fetch')
  registerAdapter('data', new FetchDataAdapter())

  const { FetchImportAdapter } = await import('./import/fetch')
  registerAdapter('import', new FetchImportAdapter())

  const { FetchSessionIndexAdapter } = await import('./session-index/fetch')
  registerAdapter('session-index', new FetchSessionIndexAdapter())

  const { FetchMessageAdapter } = await import('./message/fetch')
  registerAdapter('message', new FetchMessageAdapter())

  const { WebPlatformAdapter } = await import('./platform/web')
  registerAdapter('platform', new WebPlatformAdapter())

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

  await installAiApiShims()
}

/**
 * Install remaining window shims for SSE streaming APIs that the
 * service-layer adapters do not (yet) cover.
 */
async function installAiApiShims(): Promise<void> {
  ;(window as any).llmApi = {
    chatStream: async (
      messages: Array<{ role: string; content: string }>,
      options?: { temperature?: number; maxTokens?: number },
      onChunk?: (chunk: {
        content: string
        isFinished: boolean
        finishReason?: string
        error?: string
        thinking?: string
        thinkingDone?: boolean
      }) => void
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const { fetchSSE: fetchSSEStream } = await import('./utils/sse')
        let streamError = ''
        await fetchSSEStream({
          url: '/_web/ai/llm/chat-stream',
          method: 'POST',
          body: { messages, options },
          onEvent: ({ data }) => {
            try {
              const chunk = JSON.parse(data)
              if (chunk.error) streamError = chunk.error
              if (onChunk) onChunk(chunk)
            } catch {
              // skip malformed JSON
            }
          },
        })
        return streamError ? { success: false, error: streamError } : { success: true }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  const { fetchSSE } = await import('./utils/sse')
  const { post: httpPost } = await import('./utils/http')

  const agentApiImpl = {
    runStream: (
      userMessage: string,
      context: Record<string, unknown>,
      onChunk?: (chunk: Record<string, unknown>) => void,
      chatType?: string,
      locale?: string,
      assistantId?: string,
      _skillId?: string | null,
      _enableAutoSkill?: boolean,
      _compressionConfig?: Record<string, unknown>,
      thinkingLevel?: string
    ): {
      requestId: string
      promise: Promise<{ success: boolean; result?: Record<string, unknown>; error?: Record<string, unknown> }>
    } => {
      const localRequestId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let serverRequestId = localRequestId
      const abortController = new AbortController()

      const promise = new Promise<{
        success: boolean
        result?: Record<string, unknown>
        error?: Record<string, unknown>
      }>((resolve) => {
        let content = ''
        const toolsUsed: string[] = []
        let toolRounds = 0
        let lastUsage: Record<string, unknown> | undefined
        let hasError = false
        let streamError: Record<string, unknown> | undefined

        fetchSSE({
          url: '/_web/ai/agent/stream',
          method: 'POST',
          body: {
            userMessage,
            conversationId: context.conversationId,
            historyLeafMessageId: context.historyLeafMessageId,
            sessionId: context.sessionId,
            chatType: chatType || 'group',
            locale: locale || 'zh-CN',
            assistantId,
            compressionConfig: _compressionConfig,
            ownerInfo: context.ownerInfo,
            mentionedMembers: context.mentionedMembers,
            thinkingLevel,
          },
          signal: abortController.signal,
          onEvent: ({ event, data }) => {
            try {
              const parsed = JSON.parse(data)

              if (event === 'meta') {
                serverRequestId = parsed.requestId || localRequestId
                return
              }

              if (onChunk) onChunk(parsed)

              switch (event) {
                case 'content':
                  if (parsed.content) content += parsed.content
                  break
                case 'tool_start':
                  if (parsed.toolName) toolsUsed.push(parsed.toolName)
                  break
                case 'tool_result':
                  break
                case 'status':
                  if (parsed.status?.round !== undefined) toolRounds = parsed.status.round
                  break
                case 'error':
                  hasError = true
                  streamError = parsed.error
                  break
                case 'done':
                  if (parsed.usage) lastUsage = parsed.usage
                  break
              }
            } catch {
              // skip malformed
            }
          },
        })
          .then(() => {
            if (hasError) {
              resolve({ success: false, error: streamError })
            } else {
              resolve({
                success: true,
                result: { content, toolsUsed, toolRounds, totalUsage: lastUsage },
              })
            }
          })
          .catch((err) => {
            if (abortController.signal.aborted) {
              resolve({ success: false, error: { name: 'AbortError', message: 'Aborted' } })
            } else {
              resolve({ success: false, error: { name: 'NetworkError', message: err?.message || String(err) } })
            }
          })
      })

      // Store abort controller for external abort
      ;(agentApiImpl as any)._abortControllers = (agentApiImpl as any)._abortControllers || new Map()
      ;(agentApiImpl as any)._abortControllers.set(localRequestId, {
        abortController,
        serverRequestId: () => serverRequestId,
      })

      return { requestId: localRequestId, promise }
    },

    abort: async (requestId: string) => {
      const controllers = (agentApiImpl as any)._abortControllers as
        | Map<string, { abortController: AbortController; serverRequestId: () => string }>
        | undefined
      const entry = controllers?.get(requestId)
      if (entry) {
        entry.abortController.abort()
        controllers!.delete(requestId)
        try {
          await httpPost('/ai/agent/abort', { requestId: entry.serverRequestId() })
        } catch {
          // best-effort
        }
      }
    },
  }

  ;(window as any).agentApi = agentApiImpl

  // cacheApi shim (server-side file operations)
  // chatApi — merge-related shims (handles ↔ filePaths adaptation)
  if (!(window as any).chatApi) {
    ;(window as any).chatApi = {}
  }
  const chatApi = (window as any).chatApi
  chatApi.exportSessionsToTempFiles = async (sessionIds: string[]) => {
    try {
      const resp = await fetchWithAuth('/_web/sessions/export-for-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds }),
      })
      const result = await resp.json()
      if (!result.success) return { success: false, tempFiles: [], error: result.error }
      return { success: true, tempFiles: result.handles.map((h: { handle: string }) => h.handle) }
    } catch (error) {
      return { success: false, tempFiles: [], error: error instanceof Error ? error.message : String(error) }
    }
  }
  chatApi.cleanupTempExportFiles = async (filePaths: string[]) => {
    try {
      for (const handle of filePaths) {
        await fetchWithAuth('/_web/merge/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle }),
        })
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // mergeApi — delegates to CLI Web merge HTTP routes (handle-based)
  ;(window as any).mergeApi = {
    parseFileInfo: async (_filePath: string) => {
      // In CLI Web, sessions are pre-parsed during export-for-merge
      return { name: '', format: '', platform: '', messageCount: 0, memberCount: 0, fileSize: 0 }
    },
    checkConflicts: async (filePaths: string[]) => {
      try {
        const resp = await fetchWithAuth('/_web/merge/conflicts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handles: filePaths }),
        })
        return await resp.json()
      } catch {
        return { conflicts: [], totalMessages: 0 }
      }
    },
    mergeFiles: async (params: {
      filePaths: string[]
      outputName: string
      outputFormat?: string
      andAnalyze?: boolean
    }) => {
      try {
        const resp = await fetchWithAuth('/_web/merge/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handles: params.filePaths,
            outputName: params.outputName,
            format: params.outputFormat || 'json',
            andImport: params.andAnalyze ?? false,
          }),
        })
        return await resp.json()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    clearCache: async (filePath?: string) => {
      try {
        await fetchWithAuth('/_web/merge/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle: filePath }),
        })
        return true
      } catch {
        return false
      }
    },
  }
  ;(window as any).cacheApi = {
    saveToDownloads: async (filename: string, dataUrl: string) => {
      try {
        const resp = await fetchWithAuth('/_web/cache/save-to-downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, dataUrl }),
        })
        return await resp.json()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    showInFolder: async (filePath: string) => {
      try {
        const resp = await fetchWithAuth('/_web/cache/show-in-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
        })
        return await resp.json()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    getInfo: async () => {
      try {
        const resp = await fetchWithAuth('/_web/cache/info')
        return await resp.json()
      } catch (error) {
        return { baseDir: '', directories: [], totalSize: 0 }
      }
    },
    clear: async (cacheId: string) => {
      try {
        const resp = await fetchWithAuth('/_web/cache/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cacheId }),
        })
        return await resp.json()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    openDir: async (cacheId: string) => {
      try {
        const resp = await fetchWithAuth('/_web/cache/open-dir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cacheId }),
        })
        return await resp.json()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    getLatestImportLog: async () => {
      try {
        const resp = await fetchWithAuth('/_web/cache/latest-import-log')
        return await resp.json()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    getDataDir: async () => {
      try {
        const resp = await fetchWithAuth('/_web/cache/data-dir')
        return await resp.json()
      } catch (error) {
        return { path: '', isCustom: false }
      }
    },
  }
}

async function initWebBrowserAdapters(): Promise<void> {
  // Phase 6+: BrowserSql Adapter
  throw new Error('[services] web-browser platform not yet supported')
}
