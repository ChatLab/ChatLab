import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyUrlFromElectronResolvedProxy } from './proxy-resolver'

test('proxyUrlFromElectronResolvedProxy returns the first usable model download proxy', () => {
  assert.equal(proxyUrlFromElectronResolvedProxy('DIRECT'), undefined)
  assert.equal(proxyUrlFromElectronResolvedProxy('DIRECT; PROXY 127.0.0.1:7890'), undefined)
  assert.equal(proxyUrlFromElectronResolvedProxy('PROXY 127.0.0.1:7890; DIRECT'), 'http://127.0.0.1:7890')
  assert.equal(
    proxyUrlFromElectronResolvedProxy('HTTPS proxy.example.com:443; DIRECT'),
    'https://proxy.example.com:443'
  )
  assert.equal(
    proxyUrlFromElectronResolvedProxy('SOCKS5 127.0.0.1:1080; PROXY 127.0.0.1:7890'),
    'http://127.0.0.1:7890'
  )
  assert.equal(proxyUrlFromElectronResolvedProxy('SOCKS5 127.0.0.1:1080'), 'socks5://127.0.0.1:1080')
  assert.equal(proxyUrlFromElectronResolvedProxy('SOCKS 127.0.0.1:1080'), 'socks://127.0.0.1:1080')
})
