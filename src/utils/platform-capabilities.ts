import { IS_ELECTRON, IS_WEB_WASM } from './platform'

export type RuntimePlatform = 'electron' | 'cli-web' | 'web-wasm'

export interface PlatformCapabilities {
  platform: RuntimePlatform
  requiresAuth: boolean
  usesCliWebHttp: boolean
  usesBrowserRuntime: boolean
  loadsPreferences: boolean
  initializesLlm: boolean
  listensForPullResults: boolean
}

export interface PlatformCapabilityFlags {
  isElectron: boolean
  isWebWasm: boolean
}

export function resolvePlatformCapabilities(flags: PlatformCapabilityFlags): PlatformCapabilities {
  if (flags.isElectron) {
    return {
      platform: 'electron',
      requiresAuth: false,
      usesCliWebHttp: false,
      usesBrowserRuntime: false,
      loadsPreferences: true,
      initializesLlm: true,
      listensForPullResults: true,
    }
  }

  if (flags.isWebWasm) {
    return {
      platform: 'web-wasm',
      requiresAuth: false,
      usesCliWebHttp: false,
      usesBrowserRuntime: true,
      loadsPreferences: true,
      initializesLlm: false,
      listensForPullResults: false,
    }
  }

  return {
    platform: 'cli-web',
    requiresAuth: true,
    usesCliWebHttp: true,
    usesBrowserRuntime: false,
    loadsPreferences: true,
    initializesLlm: true,
    listensForPullResults: true,
  }
}

export const PLATFORM_CAPABILITIES = resolvePlatformCapabilities({
  isElectron: IS_ELECTRON,
  isWebWasm: IS_WEB_WASM,
})
