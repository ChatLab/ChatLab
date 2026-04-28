/**
 * 将任意错误对象序列化为 SerializedErrorInfo，
 * 保留尽可能多的 HTTP / provider 上下文，用于前端详情展示和日志记录。
 */

import type { SerializedErrorInfo } from '../../shared/types'

function safeString(val: unknown): string | null {
  if (val === undefined || val === null) return null
  if (typeof val === 'string') return val
  try {
    return JSON.stringify(val, null, 2)
  } catch {
    return String(val)
  }
}

function extractFromCandidate(candidate: unknown, info: SerializedErrorInfo): void {
  if (!candidate || typeof candidate !== 'object') return

  const rec = candidate as Record<string, unknown>

  if (typeof rec.statusCode === 'number' && info.statusCode == null) {
    info.statusCode = rec.statusCode
  }

  if (typeof rec.status === 'number' && info.statusCode == null) {
    info.statusCode = rec.status
  }

  if (typeof rec.url === 'string' && !info.url) {
    info.url = rec.url
  }

  if (typeof rec.responseBody === 'string' && !info.responseBody) {
    info.responseBody = rec.responseBody
  }

  if (rec.responseHeaders && typeof rec.responseHeaders === 'object' && !info.responseHeaders) {
    try {
      const headers = rec.responseHeaders as Record<string, unknown>
      const plain: Record<string, string> = {}
      for (const [key, val] of Object.entries(headers)) {
        plain[key] = String(val)
      }
      info.responseHeaders = plain
    } catch {
      // ignore
    }
  }

  // OpenAI SDK: headers 在 error.headers (Headers 对象)
  if (rec.headers && typeof rec.headers === 'object' && !info.responseHeaders) {
    try {
      const h = rec.headers
      if (typeof (h as any).entries === 'function') {
        const plain: Record<string, string> = {}
        for (const [key, val] of (h as any).entries()) {
          plain[key] = String(val)
        }
        if (Object.keys(plain).length > 0) {
          info.responseHeaders = plain
        }
      }
    } catch {
      // ignore
    }
  }

  if (rec.requestBodyValues !== undefined && !info.requestBody) {
    info.requestBody = safeString(rec.requestBodyValues)
  }
  if (rec.requestBody !== undefined && !info.requestBody) {
    info.requestBody = safeString(rec.requestBody)
  }

  // OpenAI SDK: error.error 包含 response body 中的 error 对象
  if (rec.error !== undefined && typeof rec.error === 'object' && !info.responseBody) {
    info.responseBody = safeString(rec.error)
  }

  if (rec.data !== undefined && !info.responseBody) {
    info.responseBody = safeString(rec.data)
  }
}

/**
 * 从错误消息字符串中尝试解析 HTTP 状态码。
 * OpenAI SDK 的 APIError.message 通常以 "NNN " 开头，如 "401 Incorrect API key..."
 */
function parseStatusCodeFromMessage(message: string | null): number | null {
  if (!message) return null
  const match = message.match(/^(\d{3})\s/)
  if (match) {
    const code = parseInt(match[1], 10)
    if (code >= 100 && code < 600) return code
  }
  return null
}

export function serializeError(error: unknown, provider?: string): SerializedErrorInfo {
  const info: SerializedErrorInfo = {
    name: null,
    message: null,
    stack: null,
  }

  if (provider) {
    info.provider = provider
  }

  if (!error) {
    info.message = 'Unknown error'
    return info
  }

  if (typeof error === 'string') {
    info.message = error
    info.statusCode = parseStatusCodeFromMessage(error)
    return info
  }

  if (!(typeof error === 'object')) {
    info.message = String(error)
    return info
  }

  const err = error as Record<string, unknown>

  if (typeof err.name === 'string') info.name = err.name
  if (typeof err.message === 'string') info.message = err.message
  if (typeof err.stack === 'string') info.stack = err.stack

  if (err.cause !== undefined) {
    info.cause = safeString(err.cause)
  }

  // Agent 层附加的上下文（provider / model / url / requestBody）
  if (err.agentContext && typeof err.agentContext === 'object') {
    const ctx = err.agentContext as Record<string, unknown>
    if (typeof ctx.provider === 'string' && !info.provider) {
      info.provider = ctx.provider
    }
    if (typeof ctx.url === 'string' && !info.url) {
      info.url = ctx.url
    }
    if (typeof ctx.requestBody === 'string' && !info.requestBody) {
      info.requestBody = ctx.requestBody
    }
  }

  // 从主错误对象及其嵌套 lastError / errors / cause 中提取 HTTP 上下文
  const candidates: unknown[] = [error]
  if (err.lastError) candidates.push(err.lastError)
  if (Array.isArray(err.errors)) candidates.push(...err.errors)
  if (err.cause && typeof err.cause === 'object') candidates.push(err.cause)

  for (const candidate of candidates) {
    extractFromCandidate(candidate, info)
  }

  // 如果没有从属性中提取到 statusCode，尝试从 message 字符串解析
  if (info.statusCode == null) {
    info.statusCode = parseStatusCodeFromMessage(info.message)
  }

  return info
}
