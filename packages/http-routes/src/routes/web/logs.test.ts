import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Fastify from 'fastify'
import { initAppLogger } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'
import { registerLogRoutes } from './logs'

function ctxWith(logsDir: string): HttpRouteContext {
  return { pathProvider: { getLogsDir: () => logsDir } } as unknown as HttpRouteContext
}

describe('logs routes', () => {
  it('appends front-end error report to app.log', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logsroute-'))
    initAppLogger(dir)
    const app = Fastify()
    registerLogRoutes(app, ctxWith(dir))
    await app.ready()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/_web/logs/report',
        payload: { level: 'error', message: 'boom', stack: 'at x', url: 'http://app/page' },
      })
      assert.equal(res.statusCode, 200)
      const content = fs.readFileSync(path.join(dir, 'app.log'), 'utf-8')
      assert.match(content, /\[ERROR\] \[web\] boom/)
      assert.match(content, /url=http:\/\/app\/page/)
    } finally {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects report without message', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logsroute-'))
    initAppLogger(dir)
    const app = Fastify()
    registerLogRoutes(app, ctxWith(dir))
    await app.ready()
    try {
      const res = await app.inject({ method: 'POST', url: '/_web/logs/report', payload: {} })
      assert.equal(res.statusCode, 400)
    } finally {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
