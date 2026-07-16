import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { createFileConfigStorage } from './file-config-storage'

test('createFileConfigStorage reads and writes JSON under the configured directory', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-config-storage-'))
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }))
  const storage = createFileConfigStorage(path.join(rootDir, 'nested', 'ai'))

  assert.equal(storage.readJson('missing'), null)
  storage.writeJson('llm-config', { enabled: true, models: ['fast'] })
  assert.deepEqual(storage.readJson('llm-config'), { enabled: true, models: ['fast'] })

  fs.writeFileSync(path.join(rootDir, 'nested', 'ai', 'invalid.json'), '{invalid', 'utf-8')
  assert.equal(storage.readJson('invalid'), null)
})
