/**
 * Unified API Client Factory
 * Automatically selects between Electron IPC client and HTTP client
 */

import type { IApiClient } from './types'
import { ElectronClient } from './electron-client'
import { HttpClient } from './http-client'

/**
 * Detect if running in Electron environment
 */
function isElectronEnvironment(): boolean {
  // Check for electron-specific globals
  if (typeof window !== 'undefined') {
    return !!(
      (window as any).electron ||
      (window as any).chatApi ||
      (window as any).aiApi ||
      process?.versions?.electron
    )
  }
  return false
}

/**
 * Global API client instance
 */
let apiClientInstance: IApiClient | null = null

/**
 * Initialize or get the API client
 * @param options - Configuration options
 * @returns API client instance
 */
export function getApiClient(options?: { baseURL?: string; forceHttp?: boolean }): IApiClient {
  if (apiClientInstance) {
    return apiClientInstance
  }

  const isElectron = !options?.forceHttp && isElectronEnvironment()

  if (isElectron) {
    apiClientInstance = new ElectronClient()
    console.log('[API Client] Using Electron IPC client')
  } else {
    const httpClient = new HttpClient(options?.baseURL)
    // Restore token from localStorage if available
    httpClient.restoreToken()
    apiClientInstance = httpClient
    console.log('[API Client] Using HTTP client')
  }

  return apiClientInstance
}

/**
 * Reset the API client instance
 * Useful for testing or switching modes
 */
export function resetApiClient(): void {
  apiClientInstance = null
}

/**
 * Get whether we're in Electron mode
 */
export function useElectronMode(): boolean {
  return isElectronEnvironment()
}

/**
 * Create a new API client instance (without caching)
 * Mainly for testing or advanced use cases
 */
export function createApiClient(options?: {
  baseURL?: string
  forceHttp?: boolean
}): IApiClient {
  const isElectron = !options?.forceHttp && isElectronEnvironment()

  if (isElectron) {
    return new ElectronClient()
  } else {
    return new HttpClient(options?.baseURL)
  }
}

/**
 * Type exports for convenience
 */
export type { IApiClient } from './types'
export * from './types'
