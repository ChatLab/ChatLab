import type { BrowserImportFormatId, BrowserParseSource, RpcProgressPayload } from '@openchatlab/web-runtime'
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

export class BrowserImportAdapter implements ImportAdapter {
  private activeImport: AbortController | undefined

  constructor(private readonly rpc: BrowserRuntimeRpcPort) {}

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
      const result = await this.rpc.request(
        'import.start',
        { source: file as BrowserParseSource, formatId, chatIndex: options?.chatIndex },
        {
          signal: controller.signal,
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

  importDemo(_locale: string, _onProgress?: (progress: DemoProgress) => void): Promise<DemoImportResult> {
    return unsupported('Demo import')
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
