import assert from 'node:assert/strict'
import test from 'node:test'
import { getStartupPerformanceSnapshot, markStartupPhase, type StartupPerformanceSnapshot } from './startup-performance'

class FakePerformance {
  private readonly entries: PerformanceEntry[] = []
  private nowValue = 0

  setNow(value: number): void {
    this.nowValue = value
  }

  mark(name: string): PerformanceMark {
    const entry = { name, entryType: 'mark', startTime: this.nowValue, duration: 0 } as PerformanceMark
    this.entries.push(entry)
    return entry
  }

  getEntriesByName(name: string, type?: string): PerformanceEntryList {
    return this.entries.filter((entry) => entry.name === name && (!type || entry.entryType === type))
  }

  getEntriesByType(type: string): PerformanceEntryList {
    return this.entries.filter((entry) => entry.entryType === type)
  }
}

test('startup phases keep their first observation across retries', () => {
  const performance = new FakePerformance()
  performance.setNow(120.126)
  markStartupPhase('services-ready', performance)
  performance.setNow(900)
  markStartupPhase('services-ready', performance)

  const snapshot = getStartupPerformanceSnapshot(performance)
  assert.equal(snapshot.phases['services-ready'], 120.13)
})

test('snapshot contains timings only and tolerates unavailable navigation data', () => {
  const performance = new FakePerformance()
  performance.setNow(42)
  markStartupPhase('renderer-module-ready', performance)

  const snapshot: StartupPerformanceSnapshot = getStartupPerformanceSnapshot(performance)
  assert.deepEqual(snapshot, {
    navigation: {
      responseEnd: null,
      domInteractive: null,
      domContentLoaded: null,
      loadEventEnd: null,
    },
    phases: { 'renderer-module-ready': 42 },
  })
})

test('snapshot keeps technical readiness separate from the intentional startup presentation', () => {
  const performance = new FakePerformance()
  performance.setNow(280)
  markStartupPhase('runtime-ready', performance)
  performance.setNow(1_800)
  markStartupPhase('startup-animation-complete', performance)
  performance.setNow(1_980)
  markStartupPhase('splash-hidden', performance)

  const snapshot = getStartupPerformanceSnapshot(performance)
  assert.deepEqual(snapshot.phases, {
    'runtime-ready': 280,
    'startup-animation-complete': 1_800,
    'splash-hidden': 1_980,
  })
})
