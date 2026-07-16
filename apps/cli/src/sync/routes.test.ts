import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import { DataSourceManager } from '@openchatlab/sync'
import { registerAutomationRoutes, type AutomationRouteContext } from '@openchatlab/http-routes'

function makeTempDir(): string {
  const baseDir = process.env.CHATLAB_TEST_TMPDIR ?? (fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir())
  return fs.mkdtempSync(path.join(baseDir, 'chatlab-sync-routes-'))
}

test('DELETE import session deletes imported local session when deleteData=true', async () => {
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
  const app = Fastify()
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

  const resp = await app.inject({
    method: 'DELETE',
    url: `/_web/automation/data-sources/${ds.id}/sessions/${session.id}?deleteData=true`,
  })

  await app.close()

  assert.equal(resp.statusCode, 200)
  assert.deepEqual(deletedSessionIds, ['local-1'])
  assert.equal(dsManager.get(ds.id)?.sessions.length, 0)
})
