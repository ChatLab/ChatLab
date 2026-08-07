import type { BrowserCapabilityReport } from '@openchatlab/web-runtime'
import type { PlatformCapabilities } from '@/utils/platform-capabilities'

export class UnsupportedBrowserCapabilitiesError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing browser capabilities: ${missing.join(', ')}`)
    this.name = 'UnsupportedBrowserCapabilitiesError'
  }
}

export interface AppInitializationPorts {
  capabilities: PlatformCapabilities
  initializeServices(): Promise<void>
  checkBrowserCapabilities?: () => Promise<BrowserCapabilityReport>
  initializePreferences(): Promise<void>
  initializeLocale(): Promise<void>
  initializeLlm?: () => Promise<void>
  loadSessions(): Promise<void>
  listenForPullResults?: () => () => void
}

export interface AppInitializationResult {
  browserCapabilities: BrowserCapabilityReport | null
  stopListeningForPullResults: (() => void) | null
}

export interface ProgressiveInitializationPorts<TPresentation> {
  initializeServices(): Promise<void>
  loadPresentation(): Promise<TPresentation>
  applyPresentation(presentation: TPresentation): Promise<void> | void
  applyPresentationFallback(): Promise<void> | void
  initializeBackground: Array<{
    name: string
    run(): Promise<void>
  }>
  listenForPullResults?: () => () => void
  presentationTimeoutMs?: number
}

export interface BackgroundInitializationFailure {
  name: string
  error: unknown
}

export interface ProgressiveInitializationResult {
  presentationError: unknown | null
  background: Promise<BackgroundInitializationFailure[]>
  stopListeningForPullResults: (() => void) | null
}

class PresentationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Presentation bootstrap timed out after ${timeoutMs}ms`)
    this.name = 'PresentationTimeoutError'
  }
}

async function loadBeforeTimeout<T>(load: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PresentationTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Desktop 与 CLI Web 的渐进式启动：服务和展示态是壳层硬依赖，
 * 其余任务并行执行并各自降级，避免一个慢服务阻塞整个界面。
 */
export async function initializeProgressiveAppRuntime<TPresentation>(
  ports: ProgressiveInitializationPorts<TPresentation>
): Promise<ProgressiveInitializationResult> {
  await ports.initializeServices()

  let presentationError: unknown | null = null
  try {
    const presentation = await loadBeforeTimeout(ports.loadPresentation, ports.presentationTimeoutMs ?? 1_000)
    await ports.applyPresentation(presentation)
  } catch (error) {
    presentationError = error
    await ports.applyPresentationFallback()
  }

  const stopListeningForPullResults = ports.listenForPullResults?.() ?? null
  const background = Promise.allSettled(ports.initializeBackground.map((task) => task.run())).then((results) =>
    results.flatMap((result, index) =>
      result.status === 'rejected' ? [{ name: ports.initializeBackground[index]!.name, error: result.reason }] : []
    )
  )

  return { presentationError, background, stopListeningForPullResults }
}

export async function initializeAppRuntime(ports: AppInitializationPorts): Promise<AppInitializationResult> {
  await ports.initializeServices()

  let browserCapabilities: BrowserCapabilityReport | null = null
  if (ports.capabilities.usesBrowserRuntime) {
    if (!ports.checkBrowserCapabilities) throw new Error('Browser capability checker is required')
    browserCapabilities = await ports.checkBrowserCapabilities()
    if (!browserCapabilities.supported) {
      throw new UnsupportedBrowserCapabilitiesError(browserCapabilities.missing)
    }
  }

  if (ports.capabilities.loadsPreferences) {
    if (!ports.initializeLocale) throw new Error('Locale initialization port is required')
    await ports.initializePreferences()
    await ports.initializeLocale()
  }
  if (ports.capabilities.initializesLlm) {
    if (!ports.initializeLlm) throw new Error('LLM initialization port is required')
    await ports.initializeLlm()
  }

  await ports.loadSessions()

  let stopListeningForPullResults: (() => void) | null = null
  if (ports.capabilities.listensForPullResults) {
    if (!ports.listenForPullResults) throw new Error('Pull result listener is required')
    stopListeningForPullResults = ports.listenForPullResults()
  }

  return {
    browserCapabilities,
    stopListeningForPullResults,
  }
}
