/**
 * Run: pnpm test -- packages/node-runtime/src/services/people/relationships/signature.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { SessionRuntimeAdapter } from '../../adapters'
import { PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION } from './compute'
import { buildPeopleRelationshipsSignature } from './signature'

test('builds the signature from database candidates without opening every session', (t) => {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  const dir = fs.mkdtempSync(path.join(baseDir, 'chatlab-relationships-signature-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const pathsById = new Map([
    ['session-b', path.join(dir, 'b.db')],
    ['session-a', path.join(dir, 'a.db')],
  ])
  for (const dbPath of pathsById.values()) fs.writeFileSync(dbPath, 'db')

  const adapter: SessionRuntimeAdapter = {
    listSessionIds: () => {
      throw new Error('signature must not validate or open every database')
    },
    listSessionCandidateIds: () => [...pathsById.keys()],
    openReadonly: () => {
      throw new Error('signature must not open databases')
    },
    openWritable: () => null,
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

  const signature = buildPeopleRelationshipsSignature(adapter)

  assert.match(signature, new RegExp(`algorithm:${PEOPLE_RELATIONSHIPS_ALGORITHM_VERSION}`))
  assert.match(signature, /range:1y/)
  assert.ok(signature.indexOf('session-a:') < signature.indexOf('session-b:'))
})
