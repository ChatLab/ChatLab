/**
 * ChatLab API — Pull discovery
 * Fetches available sessions from a remote data source via GET /sessions
 */

import { net } from 'electron'
import { normalizeBaseUrl } from './dataSource'

export interface RemoteSession {
  id: string
  name: string
  platform: string
  type: string
  messageCount?: number
  memberCount?: number
  lastMessageAt?: number
}

/**
 * Fetch available sessions from a remote data source.
 * Calls GET {baseUrl}/sessions according to the Pull protocol.
 */
export function fetchRemoteSessions(baseUrl: string, token?: string): Promise<RemoteSession[]> {
  return new Promise<RemoteSession[]>((resolve, reject) => {
    const url = normalizeBaseUrl(baseUrl) + '/sessions?format=chatlab'

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
          const parsed = JSON.parse(body)
          const sessions: RemoteSession[] = Array.isArray(parsed)
            ? parsed
            : (parsed.data?.sessions ?? parsed.sessions ?? [])
          resolve(sessions)
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
