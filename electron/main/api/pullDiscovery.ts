/**
 * ChatLab API — Pull discovery
 * Fetches available sessions from a remote data source via GET /sessions
 */

import { net } from 'electron'
import { normalizeBaseUrl } from './dataSource'
import {
  buildRemoteSessionsUrl,
  parseRemoteSessionsResponse,
  type RemoteSessionDiscoveryQuery,
  type RemoteSessionDiscoveryResult,
} from './pullDiscovery.shared'

export type { RemoteSession, RemoteSessionDiscoveryQuery, RemoteSessionDiscoveryResult } from './pullDiscovery.shared'

/**
 * Fetch available sessions from a remote data source.
 * Calls GET {baseUrl}/sessions according to the Pull protocol.
 */
export function fetchRemoteSessions(
  baseUrl: string,
  token?: string,
  query: RemoteSessionDiscoveryQuery = {}
): Promise<RemoteSessionDiscoveryResult> {
  return new Promise<RemoteSessionDiscoveryResult>((resolve, reject) => {
    const url = buildRemoteSessionsUrl(normalizeBaseUrl(baseUrl), query)

    const request = net.request(url)
    if (token) {
      request.setHeader('Authorization', `Bearer ${token}`)
    }
    request.setHeader('Accept', 'application/json')

    let body = ''

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Remote server returned HTTP ${response.statusCode}`))
        return
      }

      response.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8')
      })

      response.on('end', () => {
        try {
          resolve(parseRemoteSessionsResponse(body))
        } catch (err) {
          reject(new Error('Failed to parse remote sessions response'))
        }
      })

      response.on('error', (err: Error) => {
        reject(err)
      })
    })

    request.on('error', (err: Error) => {
      reject(err)
    })

    request.end()
  })
}
