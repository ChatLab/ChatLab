import type { BrowserCapabilities, BrowserCapabilityReport } from './rpc/protocol'

export function detectBrowserCapabilities(): BrowserCapabilityReport {
  const scope = globalThis as typeof globalThis & {
    document?: unknown
    postMessage?: unknown
    isSecureContext?: boolean
  }
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage

  const capabilities: BrowserCapabilities = {
    webAssembly: typeof WebAssembly !== 'undefined',
    dedicatedWorker: scope.document === undefined && typeof scope.postMessage === 'function',
    opfs: typeof storage?.getDirectory === 'function',
    storageEstimate: typeof storage?.estimate === 'function',
    secureContext: scope.isSecureContext === true,
  }
  const missing = (Object.entries(capabilities) as Array<[keyof BrowserCapabilities, boolean]>)
    .filter(([, supported]) => !supported)
    .map(([capability]) => capability)

  return {
    supported: missing.length === 0,
    missing,
    capabilities,
  }
}
