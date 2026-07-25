import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { proxyDemoRequest } from './[[path]].js'

describe('Web WASM demo asset proxy', () => {
  it('only proxies known localized demo files', async () => {
    const urls = []
    const response = await proxyDemoRequest({ params: { path: 'cn/demo-group.json' } }, async (url) => {
      urls.push(url)
      return new Response('demo content', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json')
    assert.equal(await response.text(), 'demo content')
    assert.deepEqual(urls, ['https://chatlab.fun/assets/demo/cn/demo-group.json'])
  })

  it('rejects unknown paths before making a remote request', async () => {
    let requested = false
    const response = await proxyDemoRequest({ params: { path: 'cn/../../secret.json' } }, async () => {
      requested = true
      return new Response()
    })

    assert.equal(response.status, 404)
    assert.equal(requested, false)
  })
})
