import type { AnalyticsEventName } from '@openchatlab/shared-types'
import type { PlatformAdapter } from '../platform/types'
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

function platformFromFormatId(formatId: string | undefined): string {
  if (!formatId) return 'unknown'
  if (formatId.includes('qq')) return 'qq'
  if (formatId.includes('weflow') || formatId.includes('wechat') || formatId.includes('echotrace')) return 'wechat'
  if (formatId.includes('whatsapp')) return 'whatsapp'
  if (formatId.includes('line')) return 'line'
  if (formatId.includes('telegram')) return 'telegram'
  if (formatId.includes('discord')) return 'discord'
  if (formatId.includes('instagram')) return 'instagram'
  if (formatId.includes('google-chat')) return 'google_chat'
  return 'unknown'
}

function classifyImportFailure(error: string | undefined): string {
  const normalized = error?.toLowerCase() ?? ''
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed') ||
    normalized.includes('networkerror') ||
    normalized.includes('network error') ||
    normalized.includes('network request failed') ||
    normalized.includes('load failed')
  ) {
    return 'network'
  }
  if (
    normalized.includes('parse') ||
    normalized.includes('format') ||
    normalized.includes('no_messages') ||
    normalized.includes('unrecognized')
  ) {
    return 'parse'
  }
  if (normalized.includes('write') || normalized.includes('database') || normalized.includes('sqlite')) {
    return 'write'
  }
  return 'unknown'
}

export class TelemetryImportAdapter implements ImportAdapter {
  private readonly filePlatforms = new WeakMap<File, string>()
  private readonly pathPlatforms = new Map<string, string>()
  private readonly sourcePlatforms = new Map<string, string>()

  constructor(
    private readonly delegate: ImportAdapter,
    private readonly platform: Pick<PlatformAdapter, 'trackAnalyticsEvent'>
  ) {}

  private track(eventName: AnalyticsEventName, properties?: Record<string, unknown>): void {
    void this.platform.trackAnalyticsEvent(eventName, properties).catch(() => {})
  }

  private rememberedPlatform(source: File | string, options?: ImportOptions): string {
    const selected = platformFromFormatId(options?.formatId)
    if (selected !== 'unknown') return selected
    return typeof source === 'string'
      ? (this.pathPlatforms.get(source) ?? 'unknown')
      : (this.filePlatforms.get(source) ?? 'unknown')
  }

  private rememberPlatform(source: File | string, platform: string): void {
    if (typeof source === 'string') this.pathPlatforms.set(source, platform)
    else this.filePlatforms.set(source, platform)
  }

  private async runTrackedImport<
    T extends { success: boolean; error?: string; platform?: string; importMode?: 'created' | 'incremental' },
  >(initialPlatform: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now()
    const trackStarted = () => this.track('chat_import_started', { chat_platform: initialPlatform })
    try {
      const result = await operation()
      if (result.importMode === 'incremental') {
        this.track('incremental_import_used')
        return result
      }
      trackStarted()
      const chatPlatform = result.platform ?? initialPlatform
      if (result.success) {
        this.track('chat_import_completed', {
          chat_platform: chatPlatform,
          duration_ms: Date.now() - startedAt,
        })
      } else {
        this.track('chat_import_failed', {
          chat_platform: chatPlatform,
          failure_reason: classifyImportFailure(result.error),
        })
      }
      return result
    } catch (error) {
      trackStarted()
      this.track('chat_import_failed', {
        chat_platform: initialPlatform,
        failure_reason: classifyImportFailure(error instanceof Error ? error.message : undefined),
      })
      throw error
    }
  }

  importFile(
    file: File | string,
    options?: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    return this.runTrackedImport(this.rememberedPlatform(file, options), () =>
      this.delegate.importFile(file, options, onProgress)
    )
  }

  cancelActiveImport(): void {
    this.delegate.cancelActiveImport?.()
  }

  async detectFormat(file: File | string): Promise<FormatInfo | null> {
    const result = await this.delegate.detectFormat(file)
    if (result) {
      this.rememberPlatform(file, result.platform)
    }
    return result
  }

  scanMultiChatFile(file: File | string): Promise<MultiChatEntry[]> {
    return this.delegate.scanMultiChatFile(file)
  }

  async prepareImportSource(file: File | string): Promise<PreparedImportSourceResult> {
    const result = await this.delegate.prepareImportSource(file)
    if (result.success && result.source) {
      this.sourcePlatforms.set(result.source.sourceId, result.source.platform)
    }
    return result
  }

  importPreparedChat(
    sourceId: string,
    chatId: string,
    onProgress?: (progress: ImportProgress) => void,
    options?: ImportOptions
  ): Promise<ImportResult> {
    return this.runTrackedImport(this.sourcePlatforms.get(sourceId) ?? 'unknown', () =>
      this.delegate.importPreparedChat(sourceId, chatId, onProgress, options)
    )
  }

  async releaseImportSource(sourceId: string): Promise<void> {
    try {
      await this.delegate.releaseImportSource(sourceId)
    } finally {
      this.sourcePlatforms.delete(sourceId)
    }
  }

  getSupportedFormats(): Promise<FormatInfo[]> {
    return this.delegate.getSupportedFormats()
  }

  importDemo(
    locale: string,
    onProgress?: (progress: DemoProgress) => void,
    options?: ImportOptions
  ): Promise<DemoImportResult> {
    return this.delegate.importDemo(locale, onProgress, options)
  }

  async analyzeIncrementalImport(sessionId: string, file: File | string): Promise<IncrementalAnalysis> {
    const result = await this.delegate.analyzeIncrementalImport(sessionId, file)
    if (result.platform) this.rememberPlatform(file, result.platform)
    return result
  }

  incrementalImport(
    sessionId: string,
    file: File | string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<IncrementalImportResult> {
    this.track('incremental_import_used')
    return this.delegate.incrementalImport(sessionId, file, onProgress)
  }

  importDirectory(
    source: File[] | string,
    options?: ImportOptions,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    const platform = platformFromFormatId(options?.formatId)
    return this.runTrackedImport(platform, () => this.delegate.importDirectory(source, options, onProgress))
  }
}
