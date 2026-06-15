/**
 * 通用 HTTP 请求工具
 *
 * 供各 FetchXxxAdapter 复用的 GET/POST 封装。
 * 支持通过 configureHttpClient 注入 token 和 401 处理。
 */

let _baseUrl = '/_web'
let _token = ''
let _getToken: (() => string) | undefined
let _on401: (() => void) | undefined

export function configureHttpClient(config: {
  baseUrl?: string
  token?: string
  getToken?: (() => string) | null
  on401?: (() => void) | null
}): void {
  if (config.baseUrl !== undefined) _baseUrl = config.baseUrl
  if (config.token !== undefined) _token = config.token
  if (config.getToken !== undefined) _getToken = config.getToken ?? undefined
  if (config.on401 !== undefined) _on401 = config.on401 ?? undefined
}

function resolveToken(): string {
  return _getToken ? _getToken() : _token
}

export function getAuthHeaders(): Record<string, string> {
  const token = resolveToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export function getBaseUrl(): string {
  return _baseUrl
}

/**
 * Resolve a URL path against the configured base.
 * When baseUrl is absolute (http://...), relative paths like "/_web/..."
 * are rewritten to the Internal Server origin. Otherwise returns as-is.
 */
function resolveFullUrl(url: string): string {
  if (!_baseUrl.startsWith('http://') && !_baseUrl.startsWith('https://')) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  try {
    const origin = new URL(_baseUrl).origin
    return `${origin}${url}`
  } catch {
    return url
  }
}

/**
 * Authenticated fetch wrapper — same API as native fetch,
 * but auto-injects Authorization header and handles 401.
 * Paths starting with / are resolved via resolveFullUrl so that
 * Electron Internal Server mode works with absolute base URLs.
 */
export async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = resolveToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const resolvedUrl = resolveFullUrl(url)
  const resp = await fetch(resolvedUrl, { ...init, headers })
  if (resp.status === 401 && _on401) _on401()
  return resp
}

function handle401(resp: Response): void {
  if (resp.status === 401 && _on401) _on401()
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(`${_baseUrl}${path}`, {
    headers: getAuthHeaders(),
    signal,
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${_baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      ...(hasBody && { 'Content-Type': 'application/json' }),
    },
    ...(hasBody && { body: JSON.stringify(body) }),
    signal,
  })
  handle401(resp)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

// ==================== 分析请求取消（epoch）====================
//
// 分析类只读请求（统计 / 分词 / 图表数据）都绑定当前「会话 + 时间筛选」。
// 切换会话或时间筛选时，上一批查询立即作废：abortAnalyticsRequests() 取消所有在途请求，
// 既释放浏览器对同源的并发连接（避免后续请求长时间 pending），又确保过期结果不会回写。
let _analyticsController = new AbortController()

/** 作废当前所有分析类在途请求，并开启新的请求 epoch。切换会话 / 时间筛选前调用。 */
export function abortAnalyticsRequests(): void {
  _analyticsController.abort()
  _analyticsController = new AbortController()
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// 已作废的请求永不 settle：避免旧数据覆盖新数据，也避免在调用方触发无意义的错误处理与空态闪烁。
function neverSettle<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

/** 绑定当前 epoch 的 GET：被 abortAnalyticsRequests() 取消时静默作废。 */
export function analyticsGet<T>(path: string): Promise<T> {
  return get<T>(path, _analyticsController.signal).catch((err) => {
    if (isAbortError(err)) return neverSettle<T>()
    throw err
  })
}

/** 绑定当前 epoch 的 POST：被 abortAnalyticsRequests() 取消时静默作废。 */
export function analyticsPost<T>(path: string, body?: unknown): Promise<T> {
  return post<T>(path, body, _analyticsController.signal).catch((err) => {
    if (isAbortError(err)) return neverSettle<T>()
    throw err
  })
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
