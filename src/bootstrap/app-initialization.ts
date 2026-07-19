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
  initializeLocale?: () => Promise<void>
  initializeLlm?: () => Promise<void>
  loadSessions(): Promise<void>
  listenForPullResults?: () => () => void
}

export interface AppInitializationResult {
  browserCapabilities: BrowserCapabilityReport | null
  stopListeningForPullResults: (() => void) | null
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
