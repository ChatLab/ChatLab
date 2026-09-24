import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { DataSourceManager } from '@openchatlab/sync'
import { registerAutomationRoutes, type AutomationRouteContext } from '@openchatlab/http-routes'
import { createApiServer } from '@openchatlab/http-routes/server'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-sync-routes-'))
}

async function createFixture(t: TestContext) {
  const settingsDir = makeTempDir()
  const dsManager = new DataSourceManager(settingsDir)
  const ds = dsManager.add({
    baseUrl: 'http://example.com',
    token: 'token',
    intervalMinutes: 60,
  })
  const [session] = dsManager.addSessions(ds.id, [{ name: 'First chat', remoteSessionId: 'remote-1' }])
  dsManager.updateSession(ds.id, session.id, { targetSessionId: 'local-1' })

  const deletedSessionIds: string[] = []
  const app = createApiServer()
  t.after(async () => {
    await app.close()
    fs.rmSync(settingsDir, { recursive: true, force: true })
  })
  const pullEngine: AutomationRouteContext['pullEngine'] = {
    triggerPull: async () => ({ success: true, newMessageCount: 0 }),
    triggerPullAll: async () => ({ success: true, newMessageCount: 0 }),
    getProgress: () => [],
  }
  registerAutomationRoutes(app, {
    automation: {
      dsManager,
      pullEngine,
      serverInfo: { port: 5200, host: '127.0.0.1', token: 'api-token' },
      deleteSessionData: (sessionId: string) => {
        deletedSessionIds.push(sessionId)
      },
    },
  })
  await app.ready()
  return { app, dsManager, ds, session, deletedSessionIds, file: path.join(settingsDir, 'data-sources.json') }
}

test('DELETE import session deletes imported local session when deleteData=true', async (t) => {
  const { app, dsManager, ds, session, deletedSessionIds } = await createFixture(t)
  const resp = await app.inject({
    method: 'DELETE',
    url: `/_web/automation/data-sources/${ds.id}/sessions/${session.id}?deleteData=true`,
  })

  assert.equal(resp.statusCode, 200)
  assert.deepEqual(deletedSessionIds, ['local-1'])
  assert.equal(dsManager.get(ds.id)?.sessions.length, 0)
})

test('corrupt data source config returns an error instead of an empty list or a successful replacement', async (t) => {
  const { app, file } = await createFixture(t)
  const broken = '[{"token":"private-test-token"} INVALID]'
  fs.writeFileSync(file, broken)
  const list = await app.inject({ method: 'GET', url: '/_web/automation/data-sources' })
  assert.equal(list.statusCode, 500)
  assert.equal(list.json().success, false)
  assert.ok(!list.body.includes('private-test-token'))
  const add = await app.inject({
    method: 'POST',
    url: '/_web/automation/data-sources',
    payload: { baseUrl: 'https://another.test', token: '', intervalMinutes: 60 },
  })
  assert.equal(add.statusCode, 500)
  assert.equal(fs.readFileSync(file, 'utf-8'), broken)
})

test('failed config persistence cannot report success or delete an imported local chat', async (t) => {
  const { app, file, ds, session, deletedSessionIds } = await createFixture(t)
  const original = fs.readFileSync(file, 'utf-8')
  const renameSync = fs.renameSync
  t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (to === file) throw Object.assign(new Error('Replacement denied'), { code: 'EPERM' })
    return renameSync(from, to)
  })
  const update = await app.inject({
    method: 'PATCH',
    url: `/_web/automation/data-sources/${ds.id}`,
    payload: { name: 'Must not be saved' },
  })
  assert.equal(update.statusCode, 500)
  assert.equal(update.json().success, false)
  const remove = await app.inject({
    method: 'DELETE',
    url: `/_web/automation/data-sources/${ds.id}/sessions/${session.id}?deleteData=true`,
  })
  assert.equal(remove.statusCode, 500)
  assert.deepEqual(deletedSessionIds, [])
  assert.equal(fs.readFileSync(file, 'utf-8'), original)
})
