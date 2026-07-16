import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAiToolRoutes } from './ai-tools'

type AiToolRouteContext = Parameters<typeof registerAiToolRoutes>[1]

function createContext(overrides: Partial<AiToolRouteContext> = {}): AiToolRouteContext {
  return {
    dbManager: {
      open: () => null,
    },
    ...overrides,
  }
}

describe('ai tool debug routes', () => {
  let app: FastifyInstance | null = null

  afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  it('delegates tool execution to the platform hook when provided', async () => {
    const calls: Array<{ toolName: string; sessionId: string; params: Record<string, unknown> }> = []
    app = Fastify()
    registerAiToolRoutes(
      app,
      createContext({
        executeAiTool: async ({ toolName, sessionId, params }) => {
          calls.push({ toolName, sessionId, params })
          return {
            success: true,
            elapsed: 12,
            content: [{ type: 'text', text: 'ok' }],
            details: { delegated: true },
            truncated: false,
          }
        },
      })
    )
    await app.ready()

    const resp = await app.inject({
      method: 'POST',
      url: '/_web/ai/tools/execute',
      payload: {
        testId: 'test-1',
        toolName: 'get_chat_overview',
        sessionId: 'chat-1',
        params: { top_n: 3 },
      },
    })

    assert.equal(resp.statusCode, 200)
    assert.deepEqual(resp.json(), {
      success: true,
      elapsed: 12,
      content: [{ type: 'text', text: 'ok' }],
      details: { delegated: true },
      truncated: false,
    })
    assert.deepEqual(calls, [{ toolName: 'get_chat_overview', sessionId: 'chat-1', params: { top_n: 3 } }])
  })

  it('aborts an active platform tool execution when cancelled', async () => {
    let startedResolve: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve
    })

    app = Fastify()
    registerAiToolRoutes(
      app,
      createContext({
        executeAiTool: async ({ abortSignal }) => {
          startedResolve?.()
          return new Promise((resolve) => {
            abortSignal.addEventListener('abort', () => resolve({ success: false, error: 'cancelled' }), { once: true })
          })
        },
      })
    )
    await app.ready()

    const executePromise = app.inject({
      method: 'POST',
      url: '/_web/ai/tools/execute',
      payload: {
        testId: 'test-cancel',
        toolName: 'get_chat_overview',
        sessionId: 'chat-1',
        params: {},
      },
    })
    await started

    const cancelResp = await app.inject({
      method: 'POST',
      url: '/_web/ai/tools/cancel',
      payload: { testId: 'test-cancel' },
    })
    const executeResp = await executePromise

    assert.equal(cancelResp.statusCode, 200)
    assert.deepEqual(cancelResp.json(), { success: true })
    assert.equal(executeResp.statusCode, 200)
    assert.deepEqual(executeResp.json(), { success: false, error: 'cancelled' })
  })

  it('keeps the shared executor fallback and missing-session response when no platform hook is provided', async () => {
    app = Fastify()
    registerAiToolRoutes(
      app,
      createContext({
        dbManager: {
          open: (sessionId: string) => (sessionId === 'existing-session' ? ({} as never) : null),
        },
      })
    )
    await app.ready()

    const resp = await app.inject({
      method: 'POST',
      url: '/_web/ai/tools/execute',
      payload: {
        testId: 'test-fallback',
        toolName: 'get_chat_overview',
        sessionId: 'missing-session',
        params: {},
      },
    })

    assert.equal(resp.statusCode, 404)
    assert.deepEqual(resp.json(), { success: false, error: 'Session not found: missing-session' })

    const fallbackResp = await app.inject({
      method: 'POST',
      url: '/_web/ai/tools/execute',
      payload: {
        testId: 'test-fallback',
        toolName: 'semantic_search_current_chat',
        sessionId: 'existing-session',
        params: { query: 'release plan' },
      },
    })

    assert.equal(fallbackResp.statusCode, 200)
    assert.equal(fallbackResp.json().success, true)
    assert.match(fallbackResp.json().content[0].text, /not available/i)
  })
})
