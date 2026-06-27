/**
 * Run: pnpm test -- packages/node-runtime/src/services/contacts-snapshot.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ContactsDiagnostics } from '@openchatlab/shared-types'
import { CONTACTS_ALGORITHM_VERSION, type ContactsSnapshot } from './contacts-compute'
import {
  cleanupContactsSnapshotTempFiles,
  getContactsSnapshotPath,
  readContactsSnapshot,
  writeContactsSnapshot,
} from './contacts-snapshot'

function makeTempDir(): string {
  const baseDir = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir()
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-contacts-snapshot-'))
}

function emptyDiagnostics(): ContactsDiagnostics {
  return {
    privateSessionCount: 0,
    contactsEnabled: false,
    skippedMissingOwnerSessions: 0,
    skippedUnresolvedOwnerSessions: 0,
    skippedAmbiguousPrivateSessions: 0,
    skippedInvalidPlatformIdMembers: 0,
    skippedFailedSessions: 0,
    hiddenLowSignalNonFriends: 0,
    warnings: [],
  }
}

function makeSnapshot(signature = 'sig-1'): ContactsSnapshot {
  return {
    contacts: [],
    diagnostics: emptyDiagnostics(),
    algorithmVersion: CONTACTS_ALGORITHM_VERSION,
    signature,
    computedAt: 1234,
    workerStats: {
      durationMs: 10,
      totalSessions: 0,
      processedSessions: 0,
      skippedFailedSessions: 0,
    },
  }
}

test('contacts snapshot reads missing file as null and writes atomically readable json', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  assert.equal(readContactsSnapshot(dir), null)

  writeContactsSnapshot(dir, makeSnapshot())

  assert.deepEqual(readContactsSnapshot(dir), makeSnapshot())
  assert.ok(fs.existsSync(getContactsSnapshotPath(dir)))
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('contacts-snapshot.tmp-')).length, 0)
})

test('contacts snapshot backs up corrupt json and returns null', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(getContactsSnapshotPath(dir), '{ broken')

  assert.equal(readContactsSnapshot(dir, { now: () => 5678 }), null)

  assert.equal(fs.existsSync(getContactsSnapshotPath(dir)), false)
  assert.ok(fs.existsSync(path.join(dir, 'contacts-snapshot.corrupt-5678.json')))
})

test('contacts snapshot cleanup removes stale temp files only', (t) => {
  const dir = makeTempDir()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'contacts-snapshot.tmp-old'), 'tmp')
  fs.writeFileSync(path.join(dir, 'contacts-snapshot.json'), '{}')

  cleanupContactsSnapshotTempFiles(dir)

  assert.equal(fs.existsSync(path.join(dir, 'contacts-snapshot.tmp-old')), false)
  assert.equal(fs.existsSync(path.join(dir, 'contacts-snapshot.json')), true)
})
