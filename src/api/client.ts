/**
 * Base HTTP client for the ChatLab web API.
 *
 * Provides a thin fetch wrapper with:
 *   - Configurable base URL (defaults to '/api' for Vite proxy)
 *   - Automatic JSON serialization / deserialization
 *   - Unified error handling
 *   - SSE (Server-Sent Events) helper for streaming endpoints
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: unknown,
  ) {
    // If the body contains an `error` string field, use it as the message.
    // Otherwise fall back to `HTTP <status>`.
    const bodyError =
      body && typeof body === 'object' && 'error' in body && typeof (body as Record<string, unknown>).error === 'string'
        ? (body as Record<string, unknown>).error as string
        : undefined
    super(bodyError ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

let baseUrl = '/api'

/** Override the base URL (useful for tests or non-proxy setups). */
export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '') // strip trailing slashes
}

/** Get the current base URL. */
export function getBaseUrl(): string {
  return baseUrl
}

// ────────────────────────────────────────────────────────────
// JSON request helpers
// ────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      // response may not be JSON
    }
    throw new ApiError(res.status, res.statusText, body)
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T

  return res.json() as Promise<T>
}

/** GET request returning parsed JSON. */
export async function get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<T> {
  let url = `${baseUrl}${path}`
  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        params.append(k, String(v))
      }
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }
  const res = await fetch(url)
  return handleResponse<T>(res)
}

/** POST request with JSON body. */
export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(res)
}

/** PUT request with JSON body. */
export async function put<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(res)
}

/** PATCH request with JSON body. */
export async function patch<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handleResponse<T>(res)
}

/** DELETE request. */
export async function del<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' })
  return handleResponse<T>(res)
}

/** POST request with FormData (file upload). */
export async function upload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse<T>(res)
}

// ────────────────────────────────────────────────────────────
// SSE helper
// ────────────────────────────────────────────────────────────

export interface SSEOptions<TChunk> {
  /** Called for every SSE `data:` line parsed as JSON. */
  onChunk: (chunk: TChunk) => void
  /** Optional AbortSignal to cancel the stream. */
  signal?: AbortSignal
}

/**
 * POST to an SSE endpoint.
 *
 * The server must respond with `Content-Type: text/event-stream`.
 * Each `data: {...}\n\n` line is parsed as JSON and forwarded to `onChunk`.
 *
 * Returns a promise that resolves when the stream ends (server closes
 * the connection or sends an empty `data:` line).
 */
/**
 * Alias for backward compatibility.
 * `streamPost(path, body, onEvent)` calls `postSSE` under the hood.
 */
export async function streamPost<TChunk>(
  path: string,
  body: unknown,
  onEvent: (event: TChunk) => void,
): Promise<void> {
  return postSSE(path, body, { onChunk: onEvent })
}

export async function postSSE<TChunk>(
  path: string,
  body: unknown,
  options: SSEOptions<TChunk>,
): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!res.ok) {
    let errBody: unknown
    try {
      errBody = await res.json()
    } catch {
      // ignore
    }
    throw new ApiError(res.status, res.statusText, errBody)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('Response body is null — streaming not supported')

  const decoder = new TextDecoder()
  let buffer = ''

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process complete SSE messages (terminated by double newline)
    const parts = buffer.split('\n\n')
    buffer = parts.pop()! // keep the incomplete tail

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6)
          if (jsonStr.trim()) {
            try {
              const chunk = JSON.parse(jsonStr) as TChunk
              options.onChunk(chunk)
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }
    }
  }
}
