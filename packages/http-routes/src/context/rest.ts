import type { RestSessionProvider } from '../routes/rest/session-provider'

/** Optional public REST capabilities supplied by hosts such as Electron External API. */
export interface RestRouteContext {
  restSessionProvider?: RestSessionProvider
}
