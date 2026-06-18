import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance } from 'fastify'
import type { SemanticIndexService } from '@openchatlab/node-runtime'
import type { HttpRouteContext } from '../../context'
import { registerSemanticIndexRoutes } from './ai-semantic-index'

type Call = [string, ...unknown[]]

function makeFakeService(calls: Call[]): SemanticIndexService {
  const status = (sessionId: string) => ({
    sessionId,
    enabled: true,
    indexStatus: 'completed' as const,
    needsRebuild: false,
    totalMessages: 10,
    indexedMessages: 10,
    chunkCount: 3,
    coverage: 1,
    queued: false,
    running: false,
    partial: false,
    error: null,
    modelId: 'm',
  })
  return {
    getConfig: () => ({ version: 1, mode: 'local', local: { modelId: 'm' }, api: null }),
    hasApiKey: () => false,
    isConfigured: () => true,
    setConfig: (c: unknown, opts?: unknown) => {
      calls.push(['setConfig', c, opts])
      return c
    },
    listEnabledStatuses: () => [status('s1')],
    status,
    statusForSessions: (ids: string[]) => {
      calls.push(['statusForSessions', ids])
      return ids.map(status)
    },
    enable: (id: string) => calls.push(['enable', id]),
    disable: (id: string) => calls.push(['disable', id]),
    build: (id: string) => calls.push(['build', id]),
    pause: (id: string) => calls.push(['pause', id]),
    cancel: (id: string) => calls.push(['cancel', id]),
    rebuild: (id: string) => calls.push(['rebuild', id]),
    buildAllPending: () => calls.push(['buildAllPending']),
    cleanupUnused: () => ({ cleaned: 2 }),
    search: async (id: string, query: string) => {
      calls.push(['search', id, query])
      return { available: true, blocks: [], coverage: 1, partial: false }
    },
  } as unknown as SemanticIndexService
}

describe('semantic-index routes', () => {
  let app: FastifyInstance
  const calls: Call[] = []

  before(async () => {
    app = Fastify()
    const ctx = { semanticIndexService: makeFakeService(calls) } as unknown as HttpRouteContext
    registerSemanticIndexRoutes(app, ctx)
    await app.ready()
  })

  after(async () => {
    await app.close()
  })

  it('GET config returns current config', async () => {
    const resp = await app.inject({ method: 'GET', url: '/_web/ai/semantic-index/config' })
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.json().config.mode, 'local')
  })

  it('PUT config forwards body to setConfig', async () => {
    const config = { version: 1, mode: 'api', local: { modelId: 'm' }, api: { baseUrl: 'b', model: 'x' } }
    const resp = await app.inject({ method: 'PUT', url: '/_web/ai/semantic-index/config', payload: { config } })
    assert.equal(resp.statusCode, 200)
    assert.ok(calls.some((c) => c[0] === 'setConfig'))
  })

  it('POST enable forwards sessionId and returns status', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/_web/ai/semantic-index/enable',
      payload: { sessionId: 'sess-9' },
    })
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.json().status.sessionId, 'sess-9')
    assert.ok(calls.some((c) => c[0] === 'enable' && c[1] === 'sess-9'))
  })

  it('POST enable without sessionId returns 400', async () => {
    const resp = await app.inject({ method: 'POST', url: '/_web/ai/semantic-index/enable', payload: {} })
    assert.equal(resp.statusCode, 400)
  })

  it('POST status (batch) forwards sessionIds', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/_web/ai/semantic-index/status',
      payload: { sessionIds: ['a', 'b'] },
    })
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.json().sessions.length, 2)
  })

  it('POST cleanup returns cleaned count', async () => {
    const resp = await app.inject({ method: 'POST', url: '/_web/ai/semantic-index/cleanup' })
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.json().cleaned, 2)
  })

  it('POST search forwards query and returns availability', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/_web/ai/semantic-index/search',
      payload: { sessionId: 's1', query: '排期' },
    })
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.json().available, true)
    assert.ok(calls.some((c) => c[0] === 'search' && c[2] === '排期'))
  })

  it('routes are skipped when service is absent', async () => {
    const bare = Fastify()
    registerSemanticIndexRoutes(bare, {} as unknown as HttpRouteContext)
    await bare.ready()
    const resp = await bare.inject({ method: 'GET', url: '/_web/ai/semantic-index/config' })
    assert.equal(resp.statusCode, 404)
    await bare.close()
  })
})
