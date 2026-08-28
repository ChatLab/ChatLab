import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensureDefaultDict } from './dict-manager'

test('ensureDefaultDict installs a bundled dictionary when the writable directory is empty', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-nlp-bundled-'))
  const bundledDir = path.join(root, 'bundled')
  const nlpDir = path.join(root, 'writable')
  fs.mkdirSync(bundledDir)
  fs.writeFileSync(path.join(bundledDir, 'zh-CN.dict'), 'bundled dictionary')

  try {
    await ensureDefaultDict(nlpDir, bundledDir)
    assert.equal(fs.readFileSync(path.join(nlpDir, 'zh-CN.dict'), 'utf8'), 'bundled dictionary')
    assert.equal(fs.existsSync(path.join(nlpDir, 'zh-CN.dict.tmp')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ensureDefaultDict preserves an existing writable dictionary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-nlp-bundled-'))
  const bundledDir = path.join(root, 'bundled')
  const nlpDir = path.join(root, 'writable')
  fs.mkdirSync(bundledDir)
  fs.mkdirSync(nlpDir)
  fs.writeFileSync(path.join(bundledDir, 'zh-CN.dict'), 'bundled dictionary')
  fs.writeFileSync(path.join(nlpDir, 'zh-CN.dict'), 'existing dictionary')

  try {
    await ensureDefaultDict(nlpDir, bundledDir)
    assert.equal(fs.readFileSync(path.join(nlpDir, 'zh-CN.dict'), 'utf8'), 'existing dictionary')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
