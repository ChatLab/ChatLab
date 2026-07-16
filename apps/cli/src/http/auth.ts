/** CLI HTTP authentication policy built on the shared Bearer hook. */

import { createBearerAuthHook } from '@openchatlab/http-routes/auth'

let cachedToken: string | null = null
let requireAuthEnabled = false

export function setAuthToken(token: string): void {
  cachedToken = token
}

/** Require Bearer auth for Web UI routes in headless or remote deployments. */
export function setRequireAuth(enabled: boolean): void {
  requireAuthEnabled = enabled
}

export const authHook = createBearerAuthHook({
  getToken: () => cachedToken,
  shouldAuthenticate: (request) =>
    request.url.startsWith('/api/') || (requireAuthEnabled && request.url.startsWith('/_web/')),
})
