import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { CliHttpAuthOptions } from './auth'
import { createServer } from './server'

const TOKEN = 'test_token'
const bearer = { authorization: `Bearer ${TOKEN}` }

function setup(t: TestContext, overrides: Partial<CliHttpAuthOptions> = {}) {
  const server = createServer({ token: TOKEN, tcpHost: '127.0.0.1', requireAuth: false, ...overrides })
  server.get('/_web/test', async () => ({ ok: true }))
  server.get('/api/v1/test', async () => ({ ok: true }))
  server.get('/assets/main.js', async () => '')
  t.after(() => server.close())
  return server
}

test('local CLI Web accepts loopback authorities without a token', async (t) => {
  const server = setup(t)
  for (const host of ['localhost:3100', '127.0.0.1:3110', '[::1]:3110']) {
    const response = await server.inject({ url: '/_web/test', headers: { host } })
    assert.equal(response.statusCode, 200, host)
  }
})

test('local CLI Web only trusts the request Host, not a forwarded Host', async (t) => {
  const server = setup(t)
  const response = await server.inject({
    url: '/_web/test',
    headers: { host: 'unrecognized.test', 'x-forwarded-host': 'localhost' },
  })
  assert.equal(response.statusCode, 400)
})

test('IPv6 loopback and Unix socket listeners keep local Web UI access', async (t) => {
  for (const [tcpHost, host] of [
    ['::1', '[::1]:3110'],
    [null, 'localhost'],
  ] as const) {
    const server = setup(t, { tcpHost })
    assert.equal((await server.inject({ url: '/_web/test', headers: { host } })).statusCode, 200)
    assert.equal((await server.inject({ url: '/_web/test', headers: { host: 'unrecognized.test' } })).statusCode, 400)
  }
})

test('non-loopback listeners always require a token for Web UI endpoints', async (t) => {
  for (const tcpHost of ['0.0.0.0', '::', '192.0.2.10']) {
    const server = setup(t, { tcpHost })
    assert.equal((await server.inject({ url: '/_web/test', headers: { host: '127.0.0.1' } })).statusCode, 401)
    assert.equal((await server.inject({ url: '/_web/test', headers: bearer })).statusCode, 200)
    assert.equal((await server.inject({ url: '/assets/main.js' })).statusCode, 200)
  }
})

test('local authenticated mode supports a proxy domain and rejects bad tokens', async (t) => {
  const server = setup(t, { requireAuth: true })
  const host = 'chatlab.example'
  assert.equal((await server.inject({ url: '/_web/test', headers: { host } })).statusCode, 401)
  assert.equal(
    (await server.inject({ url: '/_web/test', headers: { host, authorization: 'Bearer invalid' } })).statusCode,
    401
  )
  assert.equal((await server.inject({ url: '/_web/test', headers: { host, ...bearer } })).statusCode, 200)
})

test('the API always requires Bearer authentication, even with no token configured', async (t) => {
  const server = setup(t)
  const withoutToken = setup(t, { token: '' })
  assert.equal((await server.inject({ url: '/api/v1/test' })).statusCode, 401)
  assert.equal((await server.inject({ url: '/api/v1/test', headers: bearer })).statusCode, 200)
  assert.equal((await withoutToken.inject({ url: '/api/v1/test', headers: bearer })).statusCode, 401)
})
