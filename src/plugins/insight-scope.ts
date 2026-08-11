import type { Disposer } from './core'
import type { InsightTimeMode } from './insight'

export interface InsightTimeSnapshot {
  mode: InsightTimeMode
  startTs: number
  endTs: number
  isFullRange: boolean
  recentDays?: number
  year?: number
  quarterYear?: number
  quarter?: number
  customStart?: string
  customEnd?: string
}

export interface InsightScopeSnapshot {
  time?: InsightTimeSnapshot
}

export interface InsightTimeCommands {
  setAvailableYears(years: number[]): void
  switchToYear(year: number): void
}

export interface InsightScope {
  getSnapshot(): InsightScopeSnapshot
  subscribe(listener: () => void): Disposer
  setAvailableTimeYears(years: number[]): void
  switchTimeToYear(year: number): void
}

export class InsightScopeController implements InsightScope {
  private snapshot: InsightScopeSnapshot = {}
  private readonly listeners = new Set<() => void>()
  private timeCommands: InsightTimeCommands | null = null

  getSnapshot(): InsightScopeSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  updateSnapshot(snapshot: InsightScopeSnapshot): void {
    if (sameSnapshot(this.snapshot, snapshot)) return
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener())
  }

  attachTimeCommands(commands: InsightTimeCommands): Disposer {
    if (this.timeCommands) throw new Error('Insight time commands are already attached')
    this.timeCommands = commands
    return () => {
      if (this.timeCommands === commands) this.timeCommands = null
    }
  }

  setAvailableTimeYears(years: number[]): void {
    if (!this.timeCommands) throw new Error('Insight time commands are unavailable')
    this.timeCommands.setAvailableYears(years)
  }

  switchTimeToYear(year: number): void {
    if (!this.timeCommands) throw new Error('Insight time commands are unavailable')
    this.timeCommands.switchToYear(year)
  }
}

function sameSnapshot(left: InsightScopeSnapshot, right: InsightScopeSnapshot): boolean {
  const leftTime = left.time
  const rightTime = right.time
  if (!leftTime || !rightTime) return leftTime === rightTime

  return (
    leftTime.mode === rightTime.mode &&
    leftTime.startTs === rightTime.startTs &&
    leftTime.endTs === rightTime.endTs &&
    leftTime.isFullRange === rightTime.isFullRange &&
    leftTime.recentDays === rightTime.recentDays &&
    leftTime.year === rightTime.year &&
    leftTime.quarterYear === rightTime.quarterYear &&
    leftTime.quarter === rightTime.quarter &&
    leftTime.customStart === rightTime.customStart &&
    leftTime.customEnd === rightTime.customEnd
  )
}
