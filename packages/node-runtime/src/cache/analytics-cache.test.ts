/**
 * Analytics result cache tests.
 *
 * 运行：node --import tsx --test packages/node-runtime/src/cache/analytics-cache.test.ts
 *
 * 覆盖：版本指纹派生、命中/未命中、版本变更后重算覆盖、损坏缓存兜底。
 * 这些是 CLI Web 与桌面端共享的分析结果缓存核心，失效一旦错误会导致脏数据展示，必须回归。
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getDbFileVersion, getOrComputeAnalysisCache } from './analytics-cache'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-cache-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('getDbFileVersion', () => {
  it('changes when the DB file size changes', () => {
    const dbPath = path.join(tmpDir, 's1.db')
    fs.writeFileSync(dbPath, 'a')
    const v1 = getDbFileVersion(dbPath)

    fs.writeFileSync(dbPath, 'aa')
    const v2 = getDbFileVersion(dbPath)

    assert.notEqual(v1, v2, 'size change must change the version')
  })

  it('changes when the -wal sidecar appears or grows', () => {
    const dbPath = path.join(tmpDir, 's2.db')
    fs.writeFileSync(dbPath, 'main')
    const v1 = getDbFileVersion(dbPath)

    fs.writeFileSync(`${dbPath}-wal`, 'wal-bytes')
    const v2 = getDbFileVersion(dbPath)

    assert.notEqual(v1, v2, 'wal sidecar change must change the version')
  })

  it('is stable when nothing changes', () => {
    const dbPath = path.join(tmpDir, 's3.db')
    fs.writeFileSync(dbPath, 'stable')
    assert.equal(getDbFileVersion(dbPath), getDbFileVersion(dbPath))
  })

  it('does not throw when the file is missing', () => {
    assert.doesNotThrow(() => getDbFileVersion(path.join(tmpDir, 'missing.db')))
  })
})

describe('getOrComputeAnalysisCache', () => {
  const KEY = 'wf:s1-e2'

  it('computes once on cold miss and serves from cache on repeat (same version)', () => {
    let calls = 0
    const compute = () => {
      calls++
      return { words: ['a', 'b'], n: calls }
    }

    const first = getOrComputeAnalysisCache('sess', KEY, tmpDir, 'v1', compute)
    const second = getOrComputeAnalysisCache('sess', KEY, tmpDir, 'v1', compute)

    assert.equal(calls, 1, 'compute must run only once')
    assert.deepEqual(first, { words: ['a', 'b'], n: 1 })
    assert.deepEqual(second, first, 'second call must return the cached value')
  })

  it('recomputes and overwrites when the version changes', () => {
    let calls = 0
    const compute = () => {
      calls++
      return { n: calls }
    }

    getOrComputeAnalysisCache('sess', KEY, tmpDir, 'v1', compute)
    const afterChange = getOrComputeAnalysisCache('sess', KEY, tmpDir, 'v2', compute)

    assert.equal(calls, 2, 'version change must trigger recompute')
    assert.deepEqual(afterChange, { n: 2 })

    // 覆盖后，再用新版本读应命中、不再重算
    const cached = getOrComputeAnalysisCache('sess', KEY, tmpDir, 'v2', compute)
    assert.equal(calls, 2)
    assert.deepEqual(cached, { n: 2 })
  })

  it('persists the result to {sessionId}.cache.json under the cache dir', () => {
    getOrComputeAnalysisCache('persist-sess', KEY, tmpDir, 'v1', () => ({ ok: true }))
    const file = path.join(tmpDir, 'persist-sess.cache.json')
    assert.ok(fs.existsSync(file), 'cache file must be written')
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    assert.equal(parsed[KEY].data.v, 'v1')
    assert.deepEqual(parsed[KEY].data.data, { ok: true })
  })

  it('isolates entries by key within the same session file', () => {
    let calls = 0
    const compute = () => ({ n: ++calls })
    getOrComputeAnalysisCache('sess', 'k1', tmpDir, 'v1', compute)
    getOrComputeAnalysisCache('sess', 'k2', tmpDir, 'v1', compute)
    assert.equal(calls, 2, 'different keys must not collide')

    getOrComputeAnalysisCache('sess', 'k1', tmpDir, 'v1', compute)
    assert.equal(calls, 2, 'existing key must still be a hit')
  })

  it('falls back to recompute when the cache file is corrupted', () => {
    const file = path.join(tmpDir, 'sess.cache.json')
    fs.writeFileSync(file, '{ not valid json')

    let calls = 0
    const result = getOrComputeAnalysisCache('sess', KEY, tmpDir, 'v1', () => ({ n: ++calls }))
    assert.equal(calls, 1)
    assert.deepEqual(result, { n: 1 })
  })
})
