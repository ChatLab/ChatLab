/** Access policy for the CLI Web listener. */

import { isIPv4 } from 'node:net'
import { createBearerAuthHook } from '@openchatlab/http-routes/auth'
import { invalidPayload } from '@openchatlab/http-routes/errors'
import type { FastifyReply, FastifyRequest } from 'fastify'

export interface CliHttpAuthOptions {
  token: string
  /** null for a Unix domain socket. */
  tcpHost: string | null
  requireAuth: boolean
}

function isLoopbackAddress(address: string): boolean {
  return address === '::1' || (address.startsWith('127.') && isIPv4(address))
}

function isLoopbackAuthority(authority: string): boolean {
  const host = /^(localhost|\[::1\]|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/i.exec(authority)?.[1]?.toLowerCase()
  return host !== undefined && (host === 'localhost' || host === '[::1]' || isLoopbackAddress(host))
}

export function createCliAuthHook({ token, tcpHost, requireAuth }: CliHttpAuthOptions) {
  const bearerAuth = createBearerAuthHook({ getToken: () => token, allowMissingToken: false })

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // When listening on "localhost", use the actual bound address rather than assuming DNS returned a loopback IP.
    const address = tcpHost?.toLowerCase() === 'localhost' ? (request.raw.socket.localAddress ?? '') : tcpHost
    const webRequiresAuth = requireAuth || (address !== null && !isLoopbackAddress(address))

    if (!webRequiresAuth && !isLoopbackAuthority(request.headers.host ?? '')) {
      throw invalidPayload('Unrecognized Host header')
    }

    const route = request.routeOptions.url ?? ''
    if (route.startsWith('/api/') || (webRequiresAuth && route.startsWith('/_web/'))) {
      await bearerAuth(request, reply)
    }
  }
}
