/**
 * 通用 HTTP 请求工具
 *
 * 供各 FetchXxxAdapter 复用的 GET/POST 封装。
 */

const BASE = '/_web'

export async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${BASE}${path}`, {
    method: 'POST',
    ...(hasBody && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function del<T = boolean>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    ...(hasBody && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined
  const resp = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    ...(hasBody && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}
