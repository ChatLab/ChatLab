const STARTUP_MARK_PREFIX = 'chatlab:startup:'

export const STARTUP_PHASES = [
  'renderer-module-ready',
  'vue-mount-start',
  'vue-mounted',
  'services-ready',
  'runtime-ready',
  'preferences-settled',
  'locale-settled',
  'llm-settled',
  'sessions-settled',
  'shell-mounted',
  'startup-animation-complete',
  'splash-hidden',
  'shell-interactive',
  'startup-settled',
] as const

export type StartupPhase = (typeof STARTUP_PHASES)[number]

export interface StartupPerformanceSnapshot {
  navigation: {
    responseEnd: number | null
    domInteractive: number | null
    domContentLoaded: number | null
    loadEventEnd: number | null
  }
  phases: Partial<Record<StartupPhase, number>>
}

export interface StartupPerformanceApi {
  snapshot(): StartupPerformanceSnapshot
}

interface PerformanceEntriesReader {
  getEntriesByName(name: string, type?: string): PerformanceEntryList
  getEntriesByType(type: string): PerformanceEntryList
}

type PerformanceMarkRecorder = PerformanceEntriesReader & Pick<Performance, 'mark'>

declare global {
  interface Window {
    __CHATLAB_STARTUP_PERFORMANCE__?: StartupPerformanceApi
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100
}

function firstMarkStartTime(performanceEntryList: PerformanceEntriesReader, phase: StartupPhase): number | undefined {
  return performanceEntryList.getEntriesByName(`${STARTUP_MARK_PREFIX}${phase}`, 'mark')[0]?.startTime
}

function getNavigationTiming(performanceEntryList: PerformanceEntriesReader): PerformanceNavigationTiming | undefined {
  return performanceEntryList.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
}

/** Record each startup phase once so retries cannot rewrite the initial startup result. */
export function markStartupPhase(
  phase: StartupPhase,
  performanceEntryList: PerformanceMarkRecorder = performance
): void {
  const name = `${STARTUP_MARK_PREFIX}${phase}`
  if (performanceEntryList.getEntriesByName(name, 'mark').length > 0) return
  performanceEntryList.mark(name)
}

/** Mark after the current DOM update has had one opportunity to paint. */
export function markStartupPhaseAfterPaint(phase: StartupPhase): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        markStartupPhase(phase)
        resolve()
      })
    })
  })
}

export function getStartupPerformanceSnapshot(
  performanceEntryList: PerformanceEntriesReader = performance
): StartupPerformanceSnapshot {
  const navigation = getNavigationTiming(performanceEntryList)
  const phases: Partial<Record<StartupPhase, number>> = {}

  for (const phase of STARTUP_PHASES) {
    const startTime = firstMarkStartTime(performanceEntryList, phase)
    if (startTime !== undefined) phases[phase] = roundMilliseconds(startTime)
  }

  return {
    navigation: {
      responseEnd: navigation ? roundMilliseconds(navigation.responseEnd) : null,
      domInteractive: navigation ? roundMilliseconds(navigation.domInteractive) : null,
      domContentLoaded: navigation ? roundMilliseconds(navigation.domContentLoadedEventEnd) : null,
      loadEventEnd: navigation?.loadEventEnd ? roundMilliseconds(navigation.loadEventEnd) : null,
    },
    phases,
  }
}

/** Expose timings for local benchmarks and the debug console; no business data is included. */
export function installStartupPerformanceApi(target: Window = window): void {
  target.__CHATLAB_STARTUP_PERFORMANCE__ = {
    snapshot: () => getStartupPerformanceSnapshot(),
  }
}
