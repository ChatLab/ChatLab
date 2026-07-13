import { createHash } from 'node:crypto'

export const DEFAULT_IMPORT_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000

interface ImportIdempotencyEntry<T> {
  bodyHash: string
  status: 'pending' | 'success'
  response?: T
  timestamp: number
}

export type ImportIdempotencyStartResult<T> =
  | { status: 'started' }
  | { status: 'conflict' }
  | { status: 'pending' }
  | { status: 'success'; response: T }

export function hashImportBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? ''))
    .digest('hex')
}

/**
 * 进程内的请求级幂等缓存。调用方先 start，再在业务完成后 success/fail，
 * 确保 Desktop、CLI 和 Internal Server 使用同一套冲突与重试语义。
 */
export class ImportIdempotencyCache<T> {
  private entries = new Map<string, ImportIdempotencyEntry<T>>()

  constructor(private ttlMs = DEFAULT_IMPORT_IDEMPOTENCY_TTL_MS) {}

  start(key: string, bodyHash: string, now = Date.now()): ImportIdempotencyStartResult<T> {
    this.prune(now)
    const entry = this.entries.get(key)
    if (!entry) {
      this.entries.set(key, { bodyHash, status: 'pending', timestamp: now })
      return { status: 'started' }
    }
    if (entry.bodyHash !== bodyHash) return { status: 'conflict' }
    if (entry.status === 'pending') return { status: 'pending' }
    return { status: 'success', response: entry.response as T }
  }

  success(key: string, response: T): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.status = 'success'
    entry.response = response
  }

  fail(key: string): void {
    this.entries.delete(key)
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.timestamp > this.ttlMs) this.entries.delete(key)
    }
  }
}
