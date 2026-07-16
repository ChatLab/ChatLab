import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setAuthToken, setRequireAuth, authHook } from '@openchatlab/http-routes/auth'

function fakeRequest(url: string, authorization?: string) {
  return { url, headers: { authorization } } as never
}

function fakeReply() {
  let sentCode = 0
  let sentBody: unknown = null
  return {
    code(c: number) {
      sentCode = c
      return this
    },
    send(body: unknown) {
      sentBody = body
    },
    get statusCode() {
      return sentCode
    },
    get body() {
      return sentBody
    },
  }
}

const VALID_TOKEN = 'clb_test_token_12345'

describe('authHook — authentication matrix', () => {
  beforeEach(() => {
    setAuthToken(VALID_TOKEN)
    setRequireAuth(false)
  })

  // ── No token configured: all routes open ──

  it('passes all routes when no token is configured', async () => {
    setAuthToken('' as never)
    // Hack: reset internal state — setAuthToken('') won't set null, use the real function
    // Actually setAuthToken sets cachedToken to the string value. Empty string is falsy → all pass.
    const reply = fakeReply()
    await authHook(fakeRequest('/api/v1/status'), reply as never)
    assert.equal(reply.statusCode, 0, '/api/* should pass without token configured')
  })

  // ── /api/* always requires auth ──

  it('rejects /api/* without Bearer header', async () => {
    const reply = fakeReply()
    await authHook(fakeRequest('/api/v1/status'), reply as never)
    assert.equal(reply.statusCode, 401)
  })

  it('rejects /api/* with wrong token', async () => {
    const reply = fakeReply()
    await authHook(fakeRequest('/api/v1/status', 'Bearer wrong_token'), reply as never)
    assert.equal(reply.statusCode, 401)
  })

  it('allows /api/* with correct token', async () => {
    const reply = fakeReply()
    await authHook(fakeRequest('/api/v1/status', `Bearer ${VALID_TOKEN}`), reply as never)
    assert.equal(reply.statusCode, 0, 'should not send any error')
  })

  // ── /_web/* default (requireAuth=false): bypass ──

  it('allows /_web/* without auth when requireAuth=false', async () => {
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions'), reply as never)
    assert.equal(reply.statusCode, 0)
  })

  // ── /_web/* with requireAuth=true: requires token ──

  it('rejects /_web/* without Bearer when requireAuth=true', async () => {
    setRequireAuth(true)
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions'), reply as never)
    assert.equal(reply.statusCode, 401)
  })

  it('rejects /_web/* with wrong token when requireAuth=true', async () => {
    setRequireAuth(true)
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions', 'Bearer bad'), reply as never)
    assert.equal(reply.statusCode, 401)
  })

  it('allows /_web/* with correct token when requireAuth=true', async () => {
    setRequireAuth(true)
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions', `Bearer ${VALID_TOKEN}`), reply as never)
    assert.equal(reply.statusCode, 0)
  })

  // ── Static files / SPA: always public ──

  it('allows static file paths without auth', async () => {
    const reply = fakeReply()
    await authHook(fakeRequest('/index.html'), reply as never)
    assert.equal(reply.statusCode, 0)
  })

  it('allows static file paths without auth even with requireAuth=true', async () => {
    setRequireAuth(true)
    const reply = fakeReply()
    await authHook(fakeRequest('/assets/main.js'), reply as never)
    assert.equal(reply.statusCode, 0)
  })

  // ── Combined: webRoot + requireAuth (the P0 scenario) ──

  it('P0 regression: /_web/* is protected when both webRoot and requireAuth are active', async () => {
    setRequireAuth(true)
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/ai/llm/providers'), reply as never)
    assert.equal(reply.statusCode, 401, '/_web/* must NOT bypass auth when requireAuth=true')
  })

  it('P0 regression: /api/* remains protected regardless of requireAuth flag', async () => {
    setRequireAuth(false)
    const reply = fakeReply()
    await authHook(fakeRequest('/api/v1/status'), reply as never)
    assert.equal(reply.statusCode, 401, '/api/* must always require auth')
  })

  // ── setRequireAuth reset ──

  it('setRequireAuth(false) properly resets protection on /_web/*', async () => {
    setRequireAuth(true)
    setRequireAuth(false)
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions'), reply as never)
    assert.equal(reply.statusCode, 0, '/_web/* should be open after reset')
  })
})
