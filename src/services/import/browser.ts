import type { BrowserImportFormatId, BrowserParseSource, RpcProgressPayload } from '@openchatlab/web-runtime'
import { rebaseChatLabDemoDocuments } from '@openchatlab/parser/browser'
import { reportRuntimeLog } from '@/services/log-report'
import type { BrowserRuntimeRpcPort } from '../browser-runtime/types'
import type {
  DemoImportResult,
  DemoProgress,
  FormatInfo,
  ImportAdapter,
  ImportOptions,
  ImportProgress,
  ImportResult,
  IncrementalAnalysis,
  IncrementalImportResult,
  MultiChatEntry,
  PreparedImportSourceResult,
} from './types'

const DEMO_BASE_URL = '/api/demo'
const DEMO_DOWNLOAD_TIMEOUT_MS = 60_000
const DEMO_FILES = [
  'demo-group.json',
  'demo-private-A-cuilan.json',
  'demo-private-B-wukong.json',
  'demo-private-C-spider.json',
] as const

export class BrowserImportAdapter implements ImportAdapter {
  private activeImport: AbortController | undefined

  constructor(
    private readonly rpc: BrowserRuntimeRpcPort,
    private readonly fetchDemo: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly demoDownloadTimeoutMs = DEMO_DOWNLOAD_TIMEOUT_MS
  ) {}

  async importFile(
    file: File | string,
    options?: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    if (typeof file === 'string') return { success: false, error: 'File path import is not available in Web WASM' }
    if (this.activeImport) return { success: false, error: 'Another Web WASM import is already running' }

    const formatId = normalizeFormatId(options?.formatId)
    if (options?.formatId && !formatId) {
      return { success: false, error: `Unsupported Web WASM import format: ${options.formatId}` }
    }

    const controller = new AbortController()
    this.activeImport = controller
    try {
      return await this.importBrowserFile(file, formatId, options?.chatIndex, controller.signal, onProgress)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (this.activeImport === controller) this.activeImport = undefined
    }
  }

  async detectFormat(file: File | string): Promise<FormatInfo | null> {
    if (typeof file === 'string') return null
    return this.rpc.request('import.detectFormat', { source: file as BrowserParseSource })
  }

  getSupportedFormats(): Promise<FormatInfo[]> {
    return this.rpc.request('import.formats', undefined)
  }

  cancelActiveImport(): void {
    this.activeImport?.abort('Import cancelled')
  }

  scanMultiChatFile(file: File | string): Promise<MultiChatEntry[]> {
    if (typeof file === 'string') {
      return Promise.reject(new Error('File path import is not available in Web WASM'))
    }
    return this.rpc.request('import.scanChats', { source: file as BrowserParseSource })
  }

  prepareImportSource(_file: File | string): Promise<PreparedImportSourceResult> {
    return unsupported('Prepared import sources')
  }

  importPreparedChat(
    _sourceId: string,
    _chatId: string,
    _onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    return unsupported('Prepared import sources')
  }

  releaseImportSource(_sourceId: string): Promise<void> {
    return unsupported('Prepared import sources')
  }

  async importDemo(locale: string, onProgress?: (progress: DemoProgress) => void): Promise<DemoImportResult> {
    if (this.activeImport) return { success: false, error: 'Another Web WASM import is already running' }

    const controller = new AbortController()
    this.activeImport = controller
    reportRuntimeLog({ level: 'info', scope: 'web-wasm-demo', message: 'Demo import started' })
    const sessionIds: string[] = []

    try {
      const downloaded: string[] = []
      for (const filename of DEMO_FILES) {
        onProgress?.({ stage: 'downloading' })
        const content = await this.downloadDemoFile(locale, filename, controller)
        downloaded.push(new TextDecoder().decode(content))
      }

      const rebased = rebaseChatLabDemoDocuments(downloaded, this.now())
      const files = rebased.documents.map(
        (json, index) => new File([json], DEMO_FILES[index], { type: 'application/json' })
      )

      for (const file of files) {
        onProgress?.({ stage: 'importing' })
        const result = await this.importBrowserFile(file, 'chatlab', undefined, controller.signal)
        if (!result.success || !result.sessionId) {
          throw new Error(result.error || `Failed to import demo: ${file.name}`)
        }
        sessionIds.push(result.sessionId)
      }

      const [groupSessionId, ...privateSessionIds] = sessionIds
      reportRuntimeLog({
        level: 'info',
        scope: 'web-wasm-demo',
        message: 'Demo import completed',
        data: {
          sessionCount: sessionIds.length,
          offsetSeconds: rebased.offsetSeconds,
          latestTimestamp: rebased.latestTimestamp,
        },
      })
      return { success: true, groupSessionId, privateSessionIds }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const rollbackFailureCount = await this.rollbackDemoSessions(sessionIds)
      reportRuntimeLog({
        level: 'error',
        scope: 'web-wasm-demo',
        message: 'Demo import failed',
        data: { message, error },
      })
      return {
        success: false,
        error:
          rollbackFailureCount > 0
            ? `${message} (${rollbackFailureCount} imported Demo sessions could not be removed)`
            : message,
      }
    } finally {
      if (this.activeImport === controller) this.activeImport = undefined
    }
  }

  private async downloadDemoFile(
    locale: string,
    filename: (typeof DEMO_FILES)[number],
    controller: AbortController
  ): Promise<ArrayBuffer> {
    // Use one controller for user cancellation and per-file timeout so response-body reads are also abortable.
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Download demo timed out (${filename})`))
    }, this.demoDownloadTimeoutMs)

    try {
      const response = await this.fetchDemo.call(globalThis, `${DEMO_BASE_URL}/${locale}/${filename}`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Download demo failed (${filename}): HTTP ${response.status}`)

      const content = await response.arrayBuffer()
      if (content.byteLength < 100) throw new Error(`Downloaded demo file is too small (${filename})`)
      return content
    } finally {
      clearTimeout(timeout)
    }
  }

  analyzeIncrementalImport(_sessionId: string, _file: File | string): Promise<IncrementalAnalysis> {
    return unsupported('Incremental import')
  }

  incrementalImport(
    _sessionId: string,
    _file: File | string,
    _onProgress?: (progress: ImportProgress) => void
  ): Promise<IncrementalImportResult> {
    return unsupported('Incremental import')
  }

  importDirectory(
    _source: File[] | string,
    _options?: ImportOptions,
    _onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    return unsupported('Directory import')
  }

  private async importBrowserFile(
    file: File,
    formatId: BrowserImportFormatId | undefined,
    chatIndex: number | undefined,
    signal: AbortSignal,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    const result = await this.rpc.request(
      'import.start',
      { source: file as BrowserParseSource, formatId, chatIndex },
      {
        signal,
        onProgress: (progress) => onProgress?.(mapImportProgress(progress)),
      }
    )
    return {
      success: true,
      sessionId: result.sessionId,
      importMode: 'created',
      newMessageCount: result.messageCount,
      messageCount: result.messageCount,
      memberCount: result.memberCount,
    }
  }

  private async rollbackDemoSessions(sessionIds: readonly string[]): Promise<number> {
    let failureCount = 0
    for (const sessionId of [...sessionIds].reverse()) {
      try {
        const result = await this.rpc.request('session.delete', { sessionId })
        if (!result.deleted) failureCount += 1
      } catch {
        failureCount += 1
      }
    }

    if (sessionIds.length > 0) {
      reportRuntimeLog({
        level: failureCount > 0 ? 'error' : 'info',
        scope: 'web-wasm-demo',
        message: failureCount > 0 ? 'Demo import rollback incomplete' : 'Demo import rolled back',
        data: { sessionCount: sessionIds.length, failureCount },
      })
    }
    return failureCount
  }
}

function mapImportProgress(progress: RpcProgressPayload): ImportProgress {
  const stageByRuntime: Record<string, ImportProgress['stage']> = {
    detecting: 'detecting',
    parsing: 'parsing',
    catalog: 'saving',
    saving: 'saving',
    done: 'done',
  }
  const mapped: ImportProgress = {
    stage: stageByRuntime[progress.stage] ?? 'parsing',
    progress: Math.round(Math.max(0, Math.min(1, progress.progress ?? 0)) * 100),
  }
  if (progress.message !== undefined) mapped.message = progress.message
  if (progress.messagesProcessed !== undefined) mapped.messagesProcessed = progress.messagesProcessed
  return mapped
}

function normalizeFormatId(formatId: string | undefined): BrowserImportFormatId | undefined {
  return formatId === 'chatlab' ||
    formatId === 'chatlab-jsonl' ||
    formatId === 'weflow' ||
    formatId === 'whatsapp-native-txt' ||
    formatId === 'line-native-txt' ||
    formatId === 'qq-native-txt' ||
    formatId === 'telegram-native' ||
    formatId === 'telegram-native-single'
    ? formatId
    : undefined
}

function unsupported<T>(capability: string): Promise<T> {
  return Promise.reject(new Error(`${capability} is not available in Web WASM`))
}
