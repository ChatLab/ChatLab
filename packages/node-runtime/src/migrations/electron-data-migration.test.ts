import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'

test('Electron migration moves persistent system data but leaves legacy temp data untouched', async (t) => {
  const root = fs.mkdtempSync(path.join(process.env.CHATLAB_TEST_TMPDIR ?? os.tmpdir(), 'chatlab-electron-migration-'))
  const originalHome = process.env.HOME
  const electronUserData = path.join(root, 'Library', 'Application Support', 'ChatLab')
  const electronDataDir = path.join(electronUserData, 'data')
  const systemDir = path.join(root, 'system')
  const configWrites: Array<{ section: string; key: string; value: unknown }> = []
  t.after(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    fs.rmSync(root, { recursive: true, force: true })
  })

  process.env.HOME = root
  fs.mkdirSync(path.join(electronDataDir, 'databases'), { recursive: true })
  fs.mkdirSync(path.join(electronDataDir, 'ai'), { recursive: true })
  fs.mkdirSync(path.join(electronDataDir, 'temp'), { recursive: true })
  fs.writeFileSync(path.join(electronDataDir, 'databases', 'session.db'), 'sqlite')
  fs.writeFileSync(path.join(electronDataDir, 'ai', 'settings.json'), '{}')
  fs.writeFileSync(path.join(electronDataDir, 'temp', 'stale.tmp'), 'temporary')

  await mock.module('@openchatlab/config', {
    namedExports: {
      writeConfigField(section: string, key: string, value: unknown) {
        configWrites.push({ section, key, value })
      },
    },
  })

  const { migrateFromElectronIfNeeded } = await import('./electron-data-migration.js')
  const result = migrateFromElectronIfNeeded(systemDir)

  assert.equal(result.migrated, true)
  assert.deepEqual(configWrites, [{ section: 'data', key: 'user_data_dir', value: electronDataDir }])
  assert.equal(fs.readFileSync(path.join(systemDir, 'ai', 'settings.json'), 'utf-8'), '{}')
  assert.equal(fs.existsSync(path.join(systemDir, 'temp')), false)
  assert.equal(fs.readFileSync(path.join(electronDataDir, 'temp', 'stale.tmp'), 'utf-8'), 'temporary')
})
