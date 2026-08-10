import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Fastify from 'fastify'
import type { PathProvider } from '@openchatlab/core'
import type { SessionRuntimeAdapter } from '@openchatlab/node-runtime'
import { registerAiChatTopicRoutes } from './ai-chat-topics'

const nativeBinding = path.resolve('apps/cli/native/better_sqlite3.node')

test('chat topic routes expose persisted run state and reject generation without an LLM', async (t) => {
  const root = fs.mkdtempSync(path.join(fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir(), 'topic-routes-'))
  const pathProvider: PathProvider = {
    getSystemDir: () => root,
    getUserDataDir: () => path.join(root, 'data'),
    getDatabaseDir: () => path.join(root, 'data', 'databases'),
    getVectorDir: () => path.join(root, 'data', 'vector'),
    getAiDataDir: () => path.join(root, 'ai'),
    getSettingsDir: () => path.join(root, 'settings'),
    getCacheDir: () => path.join(root, 'cache'),
    getTempDir: () => path.join(root, 'temp'),
    getLogsDir: () => path.join(root, 'logs'),
    getDownloadsDir: () => path.join(root, 'downloads'),
  }
  const app = Fastify()
  t.after(() => app.close())
  registerAiChatTopicRoutes(app, {
    sessionAdapter: {} as SessionRuntimeAdapter,
    pathProvider,
    runtimeIdentity: { version: '0.35.1', kind: 'cli' },
    nativeBinding,
  })
  await app.ready()

  const latest = await app.inject({ method: 'GET', url: '/_web/sessions/group/topics/runs/latest' })
  assert.equal(latest.statusCode, 200)
  assert.equal(latest.body, 'null')

  const start = await app.inject({
    method: 'POST',
    url: '/_web/sessions/group/topics/runs',
    payload: { rangeKind: 'today', timezone: 'Asia/Shanghai', locale: 'zh-CN' },
  })
  assert.equal(start.statusCode, 400)
  assert.match(start.json().message, /LLM service is not configured/)

  const custom = await app.inject({
    method: 'POST',
    url: '/_web/sessions/group/topics/runs',
    payload: { rangeKind: 'custom', startDay: '2026-06-01', timezone: 'Asia/Shanghai' },
  })
  assert.equal(custom.statusCode, 400)
  assert.match(custom.json().message, /LLM service is not configured/)

  const missingStartDay = await app.inject({
    method: 'POST',
    url: '/_web/sessions/group/topics/runs',
    payload: { rangeKind: 'custom', timezone: 'Asia/Shanghai' },
  })
  assert.equal(missingStartDay.statusCode, 400)
  assert.match(missingStartDay.json().message, /start day is required/)

  const invalidStartDay = await app.inject({
    method: 'POST',
    url: '/_web/sessions/group/topics/runs',
    payload: { rangeKind: 'custom', startDay: '2026-02-30', timezone: 'Asia/Shanghai' },
  })
  assert.equal(invalidStartDay.statusCode, 400)
  assert.match(invalidStartDay.json().message, /Invalid day key/)
})
