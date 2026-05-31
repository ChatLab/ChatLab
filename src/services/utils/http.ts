/**
 * 通用 HTTP 请求工具
 *
 * 供各 FetchXxxAdapter 复用的 GET/POST 封装。
 * 支持通过 configureHttpClient 注入 token 和 401 处理。
 */

let _baseUrl = '/_web'
let _token = ''
let _on401: (() => void) | undefined

export function configureHttpClient(config: { baseUrl?: string; token?: string; on401?: () => void }): void {
  if (config.baseUrl !== undefined) _baseUrl = config.baseUrl
  if (config.token !== undefined) _token = config.token
  if (config.on401 !== undefined) _on401 = config.on401
}

export function getAuthHeaders(): Record<string, string> {
  if (!_token) return {}
  return { Authorization: `Bearer ${_token}` }
}

export function getBaseUrl(): string {
  return _baseUrl
}

/**
 * Authenticated fetch wrapper — same API as native fetch,
 * but auto-injects Authorization header and handles 401.
 */
export async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (_token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${_token}`)
  }
  const resp = await fetch(url, { ...init, headers })
  if (resp.status === 401 && _on401) _on401()
  return resp
}

function handle401(resp: Response): void {
  if (resp.status === 401 && _on401) _on401()
}

export async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${_baseUrl}${path}`, {
    headers: getAuthHeaders(),
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${_baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      ...(hasBody && { 'Content-Type': 'application/json' }),
    },
    ...(hasBody && { body: JSON.stringify(body) }),
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function del<T = boolean>(path: string): Promise<T> {
  const resp = await fetch(`${_baseUrl}${path}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${_baseUrl}${path}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      ...(hasBody && { 'Content-Type': 'application/json' }),
    },
    ...(hasBody && { body: JSON.stringify(body) }),
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${_baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      ...(hasBody && { 'Content-Type': 'application/json' }),
    },
    ...(hasBody && { body: JSON.stringify(body) }),
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}
