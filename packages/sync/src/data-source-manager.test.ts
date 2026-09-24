import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { DataSourceManager } from './data-source-manager'

function createFixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-data-source-config-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, file: path.join(root, 'data-sources.json'), manager: new DataSourceManager(root) }
}

const sourceInput = { name: 'Test source', baseUrl: 'https://example.test', token: 'test-token', intervalMinutes: 60 }

test('missing config can be created and existing subscriptions survive updates and reloads', (t) => {
  const { root, file, manager } = createFixture(t)
  assert.deepEqual(manager.loadAll(), [])
  const source = manager.add(sourceInput)
  const [session] = manager.addSessions(source.id, [{ name: 'Chat', remoteSessionId: 'remote-1' }])
  manager.updateSession(source.id, session.id, { targetSessionId: 'local-1', lastPullAt: 123 })
  manager.update(source.id, { name: 'Renamed source' })

  const reloaded = new DataSourceManager(root).get(source.id)
  assert.equal(reloaded?.name, 'Renamed source')
  assert.equal(reloaded?.token, sourceInput.token)
  assert.equal(reloaded?.sessions[0].targetSessionId, 'local-1')
  assert.equal(reloaded?.sessions[0].lastPullAt, 123)
  assert.deepEqual(fs.readdirSync(root), [path.basename(file)])

  // Older configurations without pullLimit still use the established default.
  const legacy = JSON.parse(fs.readFileSync(file, 'utf-8'))
  delete legacy[0].pullLimit
  fs.writeFileSync(file, JSON.stringify(legacy))
  assert.equal(manager.get(source.id)?.pullLimit, 1000)
})

test('corrupt or incompatible config is reported and cannot be replaced by CRUD operations', (t) => {
  const { file, manager } = createFixture(t)
  for (const contents of ['', '[', '{}', '[{"sessions":null}]']) {
    fs.writeFileSync(file, contents)
    const operations = [
      () => manager.loadAll(),
      () => manager.add(sourceInput),
      () => manager.update('source', { name: 'Changed' }),
      () => manager.delete('source'),
      () => manager.addSessions('source', []),
      () => manager.removeSession('source', 'session'),
      () => manager.updateSession('source', 'session', { lastPullAt: 456 }),
    ]
    for (const operation of operations) {
      assert.throws(operation)
      assert.equal(fs.readFileSync(file, 'utf-8'), contents)
    }
  }
})

test('read failures are not treated as missing config', (t) => {
  const { file, manager } = createFixture(t)
  const source = manager.add(sourceInput)
  const original = fs.readFileSync(file, 'utf-8')
  const readFileSync = fs.readFileSync
  const readMock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] === file) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    return readFileSync(...args)
  })
  assert.throws(() => manager.loadAll())
  assert.throws(() => manager.add(sourceInput))
  readMock.mock.restore()
  assert.equal(fs.readFileSync(file, 'utf-8'), original)
  assert.equal(manager.get(source.id)?.token, sourceInput.token)
})

for (const failure of ['partial-write', 'rename'] as const) {
  test(`${failure} failure preserves config, reports failure and cleans the temporary file`, (t) => {
    const { root, file, manager } = createFixture(t)
    const source = manager.add(sourceInput)
    const original = fs.readFileSync(file, 'utf-8')
    let restore: () => void
    if (failure === 'partial-write') {
      const writeFileSync = fs.writeFileSync
      const fault = t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
        if (typeof args[0] === 'string' && path.dirname(args[0]) === root) {
          writeFileSync(args[0], '[{"id":')
          throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' })
        }
        return writeFileSync(...args)
      })
      restore = () => fault.mock.restore()
    } else {
      const renameSync = fs.renameSync
      const fault = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        if (to === file) throw Object.assign(new Error('Replacement denied'), { code: 'EPERM' })
        return renameSync(from, to)
      })
      restore = () => fault.mock.restore()
    }

    assert.throws(() => manager.update(source.id, { name: 'Must not be saved' }))
    assert.equal(fs.readFileSync(file, 'utf-8'), original)
    assert.deepEqual(fs.readdirSync(root), [path.basename(file)])
    restore()
    manager.update(source.id, { name: 'Recovered' })
    assert.equal(new DataSourceManager(root).get(source.id)?.name, 'Recovered')
  })
}
