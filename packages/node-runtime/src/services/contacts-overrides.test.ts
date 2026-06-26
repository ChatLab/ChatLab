/**
 * Tests for contacts override persistence.
 *
 * Run: pnpm test -- packages/node-runtime/src/services/contacts-overrides.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initAppLogger } from '../logging/app-logger'
import { ContactsOverridesManager, buildContactOverrideKey } from './contacts-overrides'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-overrides-'))
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

test('loads empty overrides when contacts-overrides.json is missing', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const manager = new ContactsOverridesManager(dir)

  assert.equal(manager.getFilePath(), path.join(dir, 'contacts-overrides.json'))
  assert.deepEqual(manager.load(), {})
  assert.equal(manager.getSignaturePart(), '-')
})

test('saveOverride writes valid JSON and deleteOverride removes entries', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const manager = new ContactsOverridesManager(dir)

  const saved = manager.saveOverride('weixin:wxid_a', { lockedTier: 'core' })
  assert.equal(saved.lockedTier, 'core')
  assert.equal(typeof saved.updatedAt, 'number')

  assert.deepEqual(readJson(manager.getFilePath()), {
    'weixin:wxid_a': saved,
  })

  manager.deleteOverride('weixin:wxid_a')
  assert.deepEqual(readJson(manager.getFilePath()), {})
})

test('buildContactOverrideKey uses stable ids and session scope for name-match platforms', () => {
  assert.equal(buildContactOverrideKey({ platform: 'weixin', platformId: 'wxid_a' }), 'weixin:wxid_a')
  assert.equal(
    buildContactOverrideKey({ platform: 'whatsapp', platformId: 'Alice', sessionId: 'session-1', matchMode: 'name' }),
    'whatsapp:session-1:Alice'
  )
  assert.equal(
    buildContactOverrideKey({ platform: 'line', platformId: 'Bob', sessionId: 'line-session' }),
    'line:line-session:Bob'
  )
  assert.throws(() => buildContactOverrideKey({ platform: 'instagram', platformId: 'Carol' }), /sessionId is required/)
})

test('corrupt override file is backed up and loads empty overrides', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  initAppLogger(path.join(dir, 'logs'))
  const filePath = path.join(dir, 'contacts-overrides.json')
  fs.writeFileSync(filePath, '{ broken', 'utf-8')

  const manager = new ContactsOverridesManager(dir)
  assert.deepEqual(manager.load(), {})

  const backupsDir = path.join(dir, 'backups')
  const backups = fs.readdirSync(backupsDir).filter((name) => name.startsWith('contacts-overrides-corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(backupsDir, backups[0]), 'utf-8'), '{ broken')

  const log = fs.readFileSync(path.join(dir, 'logs', 'app.log'), 'utf-8')
  assert.match(log, /contacts overrides file is corrupt/)
})

test('atomic write leaves complete JSON and no temp file behind', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const manager = new ContactsOverridesManager(dir)

  manager.saveOverride('qq:10086', { lockedTier: 'core' })
  manager.saveOverride('qq:10010', { lockedTier: 'friend' })

  const raw = fs.readFileSync(manager.getFilePath(), 'utf-8')
  assert.doesNotThrow(() => JSON.parse(raw))
  assert.deepEqual(Object.keys(readJson(manager.getFilePath()) as Record<string, unknown>).sort(), [
    'qq:10010',
    'qq:10086',
  ])
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes('contacts-overrides') && name.endsWith('.tmp')),
    []
  )
  assert.notEqual(manager.getSignaturePart(), '-')
})
