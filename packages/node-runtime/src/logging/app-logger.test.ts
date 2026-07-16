import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initAppLogger, appLogger } from './app-logger'

function makeTempDir(): string {
  const base = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(base, 'applog-'))
}

function read(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
}

test('writes leveled lines with scope and extracts Error', () => {
  const dir = makeTempDir()
  delete process.env.CHATLAB_LOG_LEVEL
  initAppLogger(dir)
  appLogger.info('startup', 'app started')
  appLogger.error('crash', 'boom', new Error('kaboom'))

  const content = read(path.join(dir, 'app.log'))
  assert.match(content, /\[INFO\] \[startup\] app started/)
  assert.match(content, /\[ERROR\] \[crash\] boom/)
  assert.match(content, /kaboom/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('drops levels below threshold (INFO default skips DEBUG)', () => {
  const dir = makeTempDir()
  delete process.env.CHATLAB_LOG_LEVEL
  initAppLogger(dir)
  appLogger.debug('x', 'should be dropped')
  appLogger.info('x', 'should be kept')

  const content = read(path.join(dir, 'app.log'))
  assert.ok(!content.includes('should be dropped'))
  assert.ok(content.includes('should be kept'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('CHATLAB_LOG_LEVEL=debug lets DEBUG through', () => {
  const dir = makeTempDir()
  process.env.CHATLAB_LOG_LEVEL = 'debug'
  initAppLogger(dir)
  appLogger.debug('x', 'verbose detail')
  assert.ok(read(path.join(dir, 'app.log')).includes('verbose detail'))
  delete process.env.CHATLAB_LOG_LEVEL
  fs.rmSync(dir, { recursive: true, force: true })
})

test('rotates to app.old.log when app.log exceeds 10MB', () => {
  const dir = makeTempDir()
  delete process.env.CHATLAB_LOG_LEVEL
  initAppLogger(dir)
  const logFile = path.join(dir, 'app.log')
  const oldFile = path.join(dir, 'app.old.log')

  fs.writeFileSync(logFile, 'x'.repeat(10 * 1024 * 1024 + 1))
  appLogger.info('rot', 'after rotation')

  assert.ok(fs.existsSync(oldFile))
  assert.ok(fs.statSync(oldFile).size > 10 * 1024 * 1024)
  const content = read(logFile)
  assert.ok(content.includes('after rotation'))
  assert.ok(fs.statSync(logFile).size < 1024)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('creates nested logs dir on demand and never throws', () => {
  const dir = makeTempDir()
  initAppLogger(path.join(dir, 'a', 'b', 'c'))
  assert.doesNotThrow(() => appLogger.info('x', 'nested'))
  fs.rmSync(dir, { recursive: true, force: true })
})
