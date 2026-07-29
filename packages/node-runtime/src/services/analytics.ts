import * as path from 'path'
import { randomUUID } from 'node:crypto'
import type { AnalyticsAppType, AnalyticsEventName, AnalyticsPropertyValue } from '@openchatlab/shared-types'
import { readJsonFile, withFileLock, writeJsonFileAtomically } from '@openchatlab/config'
import { appLogger } from '../logging/app-logger'

export interface AnalyticsServiceOptions {
  appVersion: string
  appType: AnalyticsAppType
  umami?: {
    endpoint: string
    websiteId: string
  }
  getAiModelConfigured?: () => boolean
}

interface AnalyticsData {
  lastReportDate: string | null
  firstReportDate: string | null
  anonymousId: string | null
  enabled: boolean
}

interface NormalizedEvent {
  name: AnalyticsEventName
  properties: Record<string, AnalyticsPropertyValue>
}

interface AnalyticsEnvelope extends NormalizedEvent {
  anonymousId: string
  sessionId: string
  appVersion: string
  appType: AnalyticsAppType
  os: 'macos' | 'windows' | 'linux' | 'other'
  appLocale: string
  aiModelConfigured: boolean
}

const DEFAULT_DATA: AnalyticsData = {
  lastReportDate: null,
  firstReportDate: null,
  anonymousId: null,
  enabled: true,
}

const EVENT_NAMES = new Set<AnalyticsEventName>([
  'app_started',
  'app_active_new',
  'app_active',
  'chat_import_started',
  'chat_import_completed',
  'chat_import_failed',
  'incremental_import_used',
  'feature_used',
  'ai_setup_completed',
  'ai_request_started',
  'ai_request_completed',
])

const FEATURE_IDS = new Set([
  'insights',
  'ranking',
  'ai_chat',
  'sql_lab',
  'message_search',
  'member_management',
  'session_merge',
  'export',
])

const FAILURE_REASONS = new Set([
  'auth',
  'network',
  'rate_limit',
  'model_not_found',
  'aborted',
  'parse',
  'write',
  'unknown',
])

const APP_LOCALES = new Set(['zh-CN', 'zh-TW', 'en-US', 'ja-JP'])

function getUmamiConfigFromEnv(): AnalyticsServiceOptions['umami'] | undefined {
  const endpoint = process.env.UMAMI_ENDPOINT?.trim()
  const websiteId = process.env.UMAMI_WEBSITE_ID?.trim()
  return endpoint && websiteId ? { endpoint, websiteId } : undefined
}

function normalizeOs(): AnalyticsEnvelope['os'] {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'linux') return 'linux'
  return 'other'
}

function normalizeLocale(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  const trimmed = value.trim()
  return APP_LOCALES.has(trimmed) ? trimmed : 'unknown'
}

function normalizeAnalyticsImportPlatform(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  const platform = value.trim()
  // Keep custom import-format categories to measure unsupported formats.
  // This is not a general privacy sanitizer; only paths and control characters are excluded.
  const hasPathOrControlCharacter = [...platform].some(
    (char) => char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  )
  return platform.length > 0 && platform.length <= 64 && !hasPathOrControlCharacter ? platform : 'unknown'
}

function normalizeDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.min(Math.round(value), 24 * 60 * 60 * 1000)
}

function normalizeEvent(eventName: string, props: Record<string, unknown> = {}): NormalizedEvent | null {
  if (!EVENT_NAMES.has(eventName as AnalyticsEventName)) return null
  const name = eventName as AnalyticsEventName
  const properties: Record<string, AnalyticsPropertyValue> = {}

  if (name.startsWith('chat_import_')) {
    properties.chat_platform = normalizeAnalyticsImportPlatform(props.chat_platform)
  }

  if (name === 'chat_import_completed' || name === 'ai_request_completed') {
    const duration = normalizeDuration(props.duration_ms)
    if (duration !== null) properties.duration_ms = duration
  }

  if (name === 'feature_used') {
    if (typeof props.feature_id !== 'string' || !FEATURE_IDS.has(props.feature_id)) return null
    properties.feature_id = props.feature_id
  }

  if (name === 'ai_request_completed') {
    if (typeof props.success !== 'boolean') return null
    properties.success = props.success
  }

  if (name === 'chat_import_failed' || (name === 'ai_request_completed' && props.success === false)) {
    const reason = typeof props.failure_reason === 'string' ? props.failure_reason : 'unknown'
    properties.failure_reason = FAILURE_REASONS.has(reason) ? reason : 'unknown'
  }

  return { name, properties }
}

function eventPath(event: NormalizedEvent): string {
  if (event.name === 'incremental_import_used') return '/import/incremental'
  if (event.name.startsWith('chat_import_')) return '/import'
  if (event.name.startsWith('ai_')) return '/ai'
  if (event.name === 'feature_used') return `/features/${event.properties.feature_id}`
  return '/app'
}

export class AnalyticsService {
  private readonly dataPath: string
  private readonly options: AnalyticsServiceOptions
  private readonly sessionId = randomUUID()
  private appLocale = 'unknown'
  private startupAttempted = false
  // Product constraint: only one ChatLab runtime is expected to use a system directory at a time.
  // Daily-active deduplication is intentionally process-local unless concurrent runtimes become supported.
  private dailyActivePromise: Promise<void> | null = null

  constructor(systemDir: string, options: AnalyticsServiceOptions) {
    this.dataPath = path.join(systemDir, 'analytics.json')
    this.options = {
      ...options,
      umami: options.umami ?? getUmamiConfigFromEnv(),
    }
  }

  private load(): AnalyticsData {
    try {
      const stored = readJsonFile<Partial<AnalyticsData>>(this.dataPath)
      if (stored) return { ...DEFAULT_DATA, ...stored }
    } catch (error) {
      appLogger.error('analytics', 'Failed to read analytics settings; using defaults', error)
    }
    return { ...DEFAULT_DATA }
  }

  private updateData<T>(update: (data: AnalyticsData) => T, fallback: T): T {
    try {
      return withFileLock(this.dataPath, () => {
        const data = this.load()
        const result = update(data)
        writeJsonFileAtomically(this.dataPath, data, 0o600)
        return result
      })
    } catch (error) {
      appLogger.error('analytics', 'Failed to update analytics settings', error)
      return fallback
    }
  }

  private getOrCreateAnonymousId(): string {
    const fallback = randomUUID()
    return this.updateData((data) => {
      data.anonymousId ??= randomUUID()
      return data.anonymousId
    }, fallback)
  }

  private isAiModelConfigured(): boolean {
    try {
      return this.options.getAiModelConfigured?.() === true
    } catch (error) {
      appLogger.error('analytics', 'Failed to resolve AI configuration state', error)
      return false
    }
  }

  private buildEnvelope(event: NormalizedEvent): AnalyticsEnvelope {
    return {
      ...event,
      anonymousId: this.getOrCreateAnonymousId(),
      sessionId: this.sessionId,
      appVersion: this.options.appVersion,
      appType: this.options.appType,
      os: normalizeOs(),
      appLocale: this.appLocale,
      aiModelConfigured: this.isAiModelConfigured(),
    }
  }

  private commonProperties(envelope: AnalyticsEnvelope): Record<string, AnalyticsPropertyValue> {
    return {
      session_id: envelope.sessionId,
      app_version: envelope.appVersion,
      app_type: envelope.appType,
      os: envelope.os,
      app_locale: envelope.appLocale,
      ai_model_configured: envelope.aiModelConfigured,
      schema_version: 1,
    }
  }

  private async sendToUmami(envelope: AnalyticsEnvelope): Promise<boolean> {
    const umami = this.options.umami
    if (!umami) return false
    try {
      const response = await fetch(umami.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `ChatLab/${envelope.appVersion} (${envelope.os}; ${envelope.appType})`,
        },
        body: JSON.stringify({
          type: 'event',
          payload: {
            website: umami.websiteId,
            hostname: 'chatlab',
            url: eventPath(envelope),
            language: envelope.appLocale,
            name: envelope.name,
            id: envelope.anonymousId,
            data: {
              ...this.commonProperties(envelope),
              ...envelope.properties,
            },
          },
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        appLogger.warn('analytics', 'Umami rejected analytics event', {
          eventName: envelope.name,
          status: response.status,
        })
      }
      return response.ok
    } catch (error) {
      appLogger.error('analytics', 'Failed to send analytics event to Umami', error)
      return false
    }
  }

  getEnabled(): boolean {
    return this.load().enabled
  }

  setEnabled(enabled: boolean): void {
    this.updateData((data) => {
      data.enabled = enabled
    }, undefined)
  }

  setAppLocale(locale: string): void {
    this.appLocale = normalizeLocale(locale)
  }

  async track(eventName: string, props?: Record<string, unknown>): Promise<boolean> {
    if (!this.getEnabled()) return false
    if (props?.app_locale !== undefined) this.setAppLocale(String(props.app_locale))
    const event = normalizeEvent(eventName, props)
    if (!event) return false
    if (!this.options.umami) return false

    const envelope = this.buildEnvelope(event)
    const delivered = await this.sendToUmami(envelope)
    appLogger.debug('analytics', delivered ? 'Analytics event delivered' : 'Analytics event was not delivered', {
      eventName: envelope.name,
    })
    return delivered
  }

  trackDailyActive(props?: Record<string, unknown>): Promise<void> {
    if (this.dailyActivePromise) {
      const locale = props?.app_locale ?? props?.locale
      if (locale !== undefined) this.setAppLocale(String(locale))
      return this.dailyActivePromise
    }

    this.dailyActivePromise = this.trackDailyActiveInternal(props).finally(() => {
      this.dailyActivePromise = null
    })
    return this.dailyActivePromise
  }

  private async trackDailyActiveInternal(props?: Record<string, unknown>): Promise<void> {
    const locale = props?.app_locale ?? props?.locale
    if (locale !== undefined) this.setAppLocale(String(locale))

    const data = this.load()
    if (!data.enabled) return

    if (!this.startupAttempted) {
      this.startupAttempted = true
      await this.track('app_started')
    }

    const today = new Date().toISOString().slice(0, 10)
    const isNew = data.firstReportDate === null
    if (data.lastReportDate === today) return

    const tracked = await this.track(isNew ? 'app_active_new' : 'app_active')
    if (!tracked) return

    this.updateData((persisted) => {
      persisted.firstReportDate ??= today
      persisted.lastReportDate = today
    }, undefined)
  }
}
