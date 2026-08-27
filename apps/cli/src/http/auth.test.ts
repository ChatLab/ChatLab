import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setAuthToken, setRequireAuth, authHook } from './auth'

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

  // ── /_web/* default (requireAuth=false): bypass ──

  it('allows /_web/* without auth when requireAuth=false', async () => {
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions'), reply as never)
    assert.equal(reply.statusCode, 0)
  })

  const cases = [
    ['rejects /api/* without Bearer header', '/api/v1/status', undefined, false, 401],
    ['rejects /api/* with wrong token', '/api/v1/status', 'Bearer wrong_token', false, 401],
    ['allows /api/* with correct token', '/api/v1/status', `Bearer ${VALID_TOKEN}`, false, 0],
    ['rejects /_web/* without Bearer when requireAuth=true', '/_web/sessions', undefined, true, 401],
    [
      'rejects the token-bearing automation config without Bearer when requireAuth=true',
      '/_web/automation/config',
      undefined,
      true,
      401,
    ],
    ['rejects /_web/* with wrong token when requireAuth=true', '/_web/sessions', 'Bearer bad', true, 401],
    ['allows /_web/* with correct token when requireAuth=true', '/_web/sessions', `Bearer ${VALID_TOKEN}`, true, 0],
    ['allows static file paths without auth', '/index.html', undefined, false, 0],
    ['allows static file paths without auth even with requireAuth=true', '/assets/main.js', undefined, true, 0],
  ] as const

  for (const [name, url, authorization, requireAuth, expectedStatus] of cases) {
    it(name, async () => {
      setRequireAuth(requireAuth)
      const reply = fakeReply()
      await authHook(fakeRequest(url, authorization), reply as never)
      assert.equal(reply.statusCode, expectedStatus)
    })
  }

  // ── setRequireAuth reset ──

  it('setRequireAuth(false) properly resets protection on /_web/*', async () => {
    setRequireAuth(true)
    setRequireAuth(false)
    const reply = fakeReply()
    await authHook(fakeRequest('/_web/sessions'), reply as never)
    assert.equal(reply.statusCode, 0, '/_web/* should be open after reset')
  })
})
