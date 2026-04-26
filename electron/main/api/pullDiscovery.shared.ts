export interface RemoteSession {
  id: string
  name: string
  platform: string
  type: string
  messageCount?: number
  memberCount?: number
  lastMessageAt?: number
}

export interface RemoteSessionDiscoveryPage {
  hasMore: boolean
  nextCursor?: string
}

export interface RemoteSessionDiscoveryResult {
  sessions: RemoteSession[]
  page?: RemoteSessionDiscoveryPage
}

export interface RemoteSessionDiscoveryQuery {
  keyword?: string
  limit?: number
  cursor?: string
}

export function buildRemoteSessionsUrl(baseUrl: string, query: RemoteSessionDiscoveryQuery = {}): string {
  const searchParams = new URLSearchParams()
  searchParams.set('format', 'chatlab')

  if (query.keyword?.trim()) searchParams.set('keyword', query.keyword.trim())
  if (query.limit && query.limit > 0) searchParams.set('limit', String(query.limit))
  if (query.cursor) searchParams.set('cursor', query.cursor)

  return `${baseUrl}/sessions?${searchParams.toString()}`
}

/**
 * Parse remote sessions response with backward compatibility.
 * Supports: Pull protocol `{ sessions, page? }`, ChatLab API `{ success, data }`, and plain array.
 */
export function parseRemoteSessionsResponse(body: string): RemoteSessionDiscoveryResult {
  const parsed = JSON.parse(body)

  let sessions: RemoteSession[]
  let pageSource: Record<string, unknown> | undefined

  if (Array.isArray(parsed)) {
    sessions = parsed
  } else if (parsed && typeof parsed === 'object') {
    sessions = parsed.sessions ?? parsed.data?.sessions ?? parsed.data ?? []
    if (!Array.isArray(sessions)) sessions = []
    pageSource = parsed.page ?? parsed.data?.page
  } else {
    sessions = []
  }

  return {
    sessions,
    page:
      pageSource && typeof pageSource === 'object'
        ? {
            hasMore: Boolean(pageSource.hasMore),
            nextCursor: typeof pageSource.nextCursor === 'string' ? pageSource.nextCursor : undefined,
          }
        : undefined,
  }
}
