/**
 * Run: pnpm test -- packages/node-runtime/src/services/contacts-signature.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { SessionRuntimeAdapter } from './adapters'
import { CONTACTS_ALGORITHM_VERSION } from './contacts-compute'
import { buildContactsSignature } from './contacts-signature'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-signature-'))
}

function createAdapter(pathsById: Map<string, string>): SessionRuntimeAdapter {
  return {
    listSessionIds: () => [...pathsById.keys()],
    openReadonly: () => {
      throw new Error('signature must not open databases')
    },
    openWritable: () => {
      throw new Error('signature must not open databases')
    },
    closeSession: () => {},
    getDbPath: (sessionId) => pathsById.get(sessionId) ?? '',
    deleteSessionFile: () => false,
    ensureReadonly: () => {
      throw new Error('signature must not open databases')
    },
    ensureWritable: () => {
      throw new Error('signature must not open databases')
    },
  }
}

test('contacts signature is stable for sorted session ids and db file versions', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const first = path.join(dir, 'b.db')
  const second = path.join(dir, 'a.db')
  fs.writeFileSync(first, 'first')
  fs.writeFileSync(second, 'second')
  const adapter = createAdapter(
    new Map([
      ['session-b', first],
      ['session-a', second],
    ])
  )

  const signature = buildContactsSignature(adapter)

  assert.match(signature, new RegExp(`algorithm:${CONTACTS_ALGORITHM_VERSION}`))
  assert.ok(signature.indexOf('session-a:') < signature.indexOf('session-b:'))
  assert.match(signature, /session-a:[^|]+/)
  assert.match(signature, /session-b:[^|]+/)
})

test('contacts signature changes when wal file version changes', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'session.db')
  fs.writeFileSync(dbPath, 'db')
  const adapter = createAdapter(new Map([['session', dbPath]]))

  const before = buildContactsSignature(adapter)
  fs.writeFileSync(`${dbPath}-wal`, 'wal')
  const after = buildContactsSignature(adapter)

  assert.notEqual(after, before)
  assert.match(after, /session:[^|]+\|[^|]+/)
})
