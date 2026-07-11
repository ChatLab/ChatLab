import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { SessionRuntimeAdapter } from '../adapters'
import { buildAnnualSummarySignature } from './signature'

test('signature changes with range date, session list, and DB or WAL state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-global-insight-signature-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = path.join(dir, 'a.db')
  const b = path.join(dir, 'b.db')
  fs.writeFileSync(a, 'a')
  fs.writeFileSync(b, 'b')
  let ids = ['b', 'a']
  const adapter = {
    listSessionIds: () => ids,
    getDbPath: (id: string) => (id === 'a' ? a : b),
  } as unknown as SessionRuntimeAdapter
  const year = { mode: 'year' as const, year: 2026, startTs: 1, endTs: 2 }

  const initial = buildAnnualSummarySignature(adapter, year)
  assert.equal(initial, buildAnnualSummarySignature(adapter, year))
  assert.notEqual(initial, buildAnnualSummarySignature(adapter, { ...year, year: 2025 }))

  fs.writeFileSync(`${a}-wal`, 'wal')
  assert.notEqual(initial, buildAnnualSummarySignature(adapter, year))

  ids = ['a']
  assert.notEqual(initial, buildAnnualSummarySignature(adapter, year))
})
