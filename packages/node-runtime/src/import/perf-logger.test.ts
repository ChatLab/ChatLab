import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createImportPerfLogger } from './perf-logger'

test('keeps concurrent import performance logs isolated', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-perf-log-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const first = createImportPerfLogger(root)
  const second = createImportPerfLogger(root)
  first.init('first')
  second.init('second')
  first.info('first-only')
  second.info('second-only')
  first.error('first-error')

  const firstPath = first.getCurrentLogFile()
  const secondPath = second.getCurrentLogFile()
  assert.ok(firstPath)
  assert.ok(secondPath)
  assert.notEqual(firstPath, secondPath)
  assert.match(fs.readFileSync(firstPath, 'utf8'), /first-only/)
  assert.doesNotMatch(fs.readFileSync(firstPath, 'utf8'), /second-only/)
  assert.match(fs.readFileSync(secondPath, 'utf8'), /second-only/)
  assert.doesNotMatch(fs.readFileSync(secondPath, 'utf8'), /first-only/)
  assert.equal(first.getErrorCount(), 1)
  assert.equal(second.getErrorCount(), 0)

  first.reset()
  assert.equal(first.getCurrentLogFile(), null)
  assert.equal(second.getCurrentLogFile(), secondPath)
})
