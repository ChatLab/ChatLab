/**
 * Regression tests for the jieba instance cache.
 *
 * Bug history: when no custom dict existed on disk, every getJieba() call
 * invalidated the cache and rebuilt a Jieba instance, making hot paths
 * (FTS indexing tokenizes every message) rebuild jieba per call and slowing
 * imports by seconds. The cache must only invalidate when the on-disk dict
 * state actually changes (dict added or removed).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { getJieba, initNlpDir } from '../segmenter'

// Minimal valid jieba user dict: "word freq tag" lines.
const MINIMAL_DICT = '测试词 100 n\n'

describe('getJieba instance cache', () => {
  it('reuses the cached instance across calls when no dict exists on disk', () => {
    const nlpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-nlp-'))
    initNlpDir(nlpDir)

    const first = getJieba('zh-CN')
    const second = getJieba('zh-CN')
    assert.equal(second, first, 'expected the same cached jieba instance without dict changes')
  })

  it('invalidates the cache when a dict file is added, then stays stable', () => {
    const nlpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-nlp-'))
    initNlpDir(nlpDir)

    const withoutDict = getJieba('zh-CN')
    fs.writeFileSync(path.join(nlpDir, 'zh-CN.dict'), MINIMAL_DICT)

    const withDict = getJieba('zh-CN')
    assert.notEqual(withDict, withoutDict, 'expected a rebuilt instance after dict was added')
    assert.equal(getJieba('zh-CN'), withDict, 'expected the dict-backed instance to stay cached')
  })

  it('invalidates the cache when the dict file is removed', () => {
    const nlpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-nlp-'))
    initNlpDir(nlpDir)
    fs.writeFileSync(path.join(nlpDir, 'zh-CN.dict'), MINIMAL_DICT)

    const withDict = getJieba('zh-CN')
    fs.rmSync(path.join(nlpDir, 'zh-CN.dict'))

    const withoutDict = getJieba('zh-CN')
    assert.notEqual(withoutDict, withDict, 'expected a rebuilt instance after dict was removed')
    assert.equal(getJieba('zh-CN'), withoutDict, 'expected the fallback instance to stay cached')
  })
})
