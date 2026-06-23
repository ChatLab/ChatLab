import * as fs from 'fs'
import * as path from 'path'

const REGIONS: Record<string, string> = {
  US: 'https://us.aptabase.com',
  EU: 'https://eu.aptabase.com',
}

interface AnalyticsData {
  lastReportDate: string | null
  firstReportDate: string | null
  enabled: boolean
}

const DEFAULT_DATA: AnalyticsData = { lastReportDate: null, firstReportDate: null, enabled: true }

export class AnalyticsService {
  private readonly dataPath: string
  private readonly endpoint: string | null
  private readonly appKey: string
  private readonly appVersion: string
  private readonly sessionId: string

  constructor(systemDir: string, appKey: string, appVersion: string) {
    this.dataPath = path.join(systemDir, 'analytics.json')
    this.appKey = appKey
    this.appVersion = appVersion
    this.sessionId = `${Math.floor(Date.now() / 1000)}${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, '0')}`
    const parts = appKey.split('-')
    const base = parts.length === 3 ? REGIONS[parts[1]] : undefined
    this.endpoint = base ? `${base}/api/v0/event` : null
  }

  private load(): AnalyticsData {
    try {
      if (fs.existsSync(this.dataPath)) {
        return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(this.dataPath, 'utf-8')) }
      }
    } catch (_e) {
      // Corrupted or unreadable file — fall back to defaults
    }
    return { ...DEFAULT_DATA }
  }

  private save(data: AnalyticsData): void {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.error('[Analytics] Failed to save:', e)
    }
  }

  getEnabled(): boolean {
    return this.load().enabled
  }

  setEnabled(enabled: boolean): void {
    const data = this.load()
    data.enabled = enabled
    this.save(data)
  }

  async track(eventName: string, props?: Record<string, string | number>): Promise<void> {
    if (!this.endpoint) return
    if (!this.getEnabled()) return
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'App-Key': this.appKey },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId,
          eventName,
          systemProps: {
            isDebug: false,
            locale: '',
            osName: process.platform,
            osVersion: '',
            engineName: 'Node.js',
            engineVersion: process.versions.node,
            appVersion: this.appVersion,
            sdkVersion: 'chatlab@1',
          },
          props,
        }),
      })
    } catch (e) {
      console.error(`[Analytics] Failed to track ${eventName}:`, e)
    }
  }

  async trackDailyActive(props?: Record<string, string | number>): Promise<void> {
    if (!this.endpoint) return
    const data = this.load()
    if (!data.enabled) return
    const today = new Date().toISOString().slice(0, 10)
    const isNew = data.firstReportDate === null
    if (isNew) data.firstReportDate = today
    if (data.lastReportDate === today) {
      if (isNew) this.save(data)
      return
    }
    await this.track(isNew ? 'app_active_new' : 'app_active', props)
    data.lastReportDate = today
    this.save(data)
  }
}
