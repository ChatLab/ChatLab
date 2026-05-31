/**
 * 通用 SSE（Server-Sent Events）客户端
 *
 * 封装 fetch + ReadableStream 解析 SSE 流，
 * 供各 FetchXxxAdapter 复用。
 * 自动注入 Authorization header（通过 http.ts 的 getAuthHeaders）。
 */

import { getAuthHeaders } from './http'

export interface SSEEvent {
  event: string
  data: string
}

export interface FetchSSEOptions {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  onEvent: (event: SSEEvent) => void
}

/**
 * 发起 SSE 请求并逐事件回调。
 * Promise 在流结束时 resolve，出错时 reject。
 */
export async function fetchSSE(options: FetchSSEOptions): Promise<void> {
  const { url, method = 'POST', headers = {}, body, signal, onEvent } = options

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`SSE request failed: HTTP ${resp.status} ${text}`)
  }

  if (!resp.body) {
    throw new Error('SSE response has no body')
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        onEvent({ event: currentEvent, data: line.slice(6) })
        currentEvent = ''
      }
    }
  }

  if (buffer.trim()) {
    if (buffer.startsWith('data: ')) {
      onEvent({ event: currentEvent, data: buffer.slice(6) })
    }
  }
}

/**
 * 便捷方法：发起 SSE 请求，按 event type 分发解析后的 JSON。
 */
export async function fetchSSEWithHandlers<TResult = unknown>(options: {
  url: string
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  onProgress?: (data: unknown) => void
  resultEvent?: string
}): Promise<TResult> {
  const { url, method, body, signal, onProgress, resultEvent = 'result' } = options

  return new Promise<TResult>((resolve, reject) => {
    let resolved = false

    fetchSSE({
      url,
      method,
      body,
      signal,
      onEvent: ({ event, data }) => {
        try {
          const parsed = JSON.parse(data)
          if (event === resultEvent) {
            resolved = true
            resolve(parsed as TResult)
          } else if (event === 'progress' && onProgress) {
            onProgress(parsed)
          }
        } catch {
          // skip malformed JSON
        }
      },
    })
      .then(() => {
        if (!resolved) reject(new Error('SSE stream ended without result event'))
      })
      .catch(reject)
  })
}
