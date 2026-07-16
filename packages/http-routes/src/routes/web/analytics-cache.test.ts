/**
 * buildAnalyticsCacheKey tests.
 *
 * Run: pnpm test -- packages/http-routes/src/routes/web/analytics-cache.test.ts
 *
 * 键的确定性直接决定缓存命中率与正确性：等价请求必须同键，不同请求必须异键。
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildAnalyticsCacheKey, withAnalyticsCache } from './analytics-cache'
import type { HttpRouteContext } from '../../context'

describe('buildAnalyticsCacheKey', () => {
  it('is independent of param key order', () => {
    const a = buildAnalyticsCacheKey('wf', { startTs: 1, endTs: 2, memberId: 3 })
    const b = buildAnalyticsCacheKey('wf', { memberId: 3, endTs: 2, startTs: 1 })
    assert.equal(a, b)
  })

  it('ignores undefined params', () => {
    const a = buildAnalyticsCacheKey('wf', { startTs: 1, memberId: undefined })
    const b = buildAnalyticsCacheKey('wf', { startTs: 1 })
    assert.equal(a, b)
  })

  it('separates by namespace', () => {
    const a = buildAnalyticsCacheKey('catchphrase', { startTs: 1 })
    const b = buildAnalyticsCacheKey('mention', { startTs: 1 })
    assert.notEqual(a, b)
  })

  it('distinguishes different param values', () => {
    const a = buildAnalyticsCacheKey('wf', { startTs: 1, endTs: 2 })
    const b = buildAnalyticsCacheKey('wf', { startTs: 1, endTs: 3 })
    assert.notEqual(a, b)
  })

  it('handles nested arrays/objects deterministically', () => {
    const a = buildAnalyticsCacheKey('wf', { excludeWords: ['b', 'a'], pos: { mode: 'custom' } })
    const b = buildAnalyticsCacheKey('wf', { pos: { mode: 'custom' }, excludeWords: ['b', 'a'] })
    assert.equal(a, b)
    const c = buildAnalyticsCacheKey('wf', { excludeWords: ['a', 'b'] })
    assert.notEqual(a, c, 'array order is significant')
  })
})

describe('withAnalyticsCache', () => {
  let root: string
  let dbPath: string

  function makeCtx(): HttpRouteContext {
    return {
      pathProvider: { getCacheDir: () => path.join(root, 'cache') },
      sessionAdapter: { getDbPath: () => dbPath },
      getVersion: () => '0.0.0-test',
    } as unknown as HttpRouteContext
  }

  beforeEach(() => {
    const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
    root = fs.mkdtempSync(path.join(baseDir, 'chatlab-analytics-cache-'))
    dbPath = path.join(root, 'session.db')
    fs.writeFileSync(dbPath, 'db-v1')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('computes once then serves the cached value on the second call', () => {
    const ctx = makeCtx()
    let calls = 0
    const compute = () => {
      calls++
      return { value: calls }
    }
    const first = withAnalyticsCache(ctx, 's1', 'nlp.word-frequency', { startTs: 1 }, compute)
    const second = withAnalyticsCache(ctx, 's1', 'nlp.word-frequency', { startTs: 1 }, compute)
    assert.equal(calls, 1)
    assert.deepEqual(first, { value: 1 })
    assert.deepEqual(second, { value: 1 })
    // 缓存确实落到了磁盘 cacheDir/query 下
    const cacheFile = path.join(root, 'cache', 'query', 's1.cache.json')
    assert.ok(fs.existsSync(cacheFile))
  })

  it('recomputes after the db file changes (size/mtime fingerprint)', () => {
    const ctx = makeCtx()
    let calls = 0
    const compute = () => {
      calls++
      return { value: calls }
    }
    withAnalyticsCache(ctx, 's1', 'nlp.word-frequency', { startTs: 1 }, compute)
    fs.writeFileSync(dbPath, 'db-v2-with-more-bytes') // 改变文件大小 => 版本变化
    const after = withAnalyticsCache(ctx, 's1', 'nlp.word-frequency', { startTs: 1 }, compute)
    assert.equal(calls, 2)
    assert.deepEqual(after, { value: 2 })
  })

  it('isolates entries by params and by session', () => {
    const ctx = makeCtx()
    let calls = 0
    const compute = () => {
      calls++
      return { value: calls }
    }
    withAnalyticsCache(ctx, 's1', 'nlp.word-frequency', { startTs: 1 }, compute)
    withAnalyticsCache(ctx, 's1', 'nlp.word-frequency', { startTs: 2 }, compute)
    withAnalyticsCache(ctx, 's2', 'nlp.word-frequency', { startTs: 1 }, compute)
    assert.equal(calls, 3)
  })
})
