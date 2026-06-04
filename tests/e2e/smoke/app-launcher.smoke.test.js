'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const { launchApp } = require('../helpers/app-launcher')

const shouldRunSmoke = process.env.CHATLAB_RUN_E2E_SMOKE === '1'

async function waitForCdpReady(port, timeoutMs = 15000) {
  const start = Date.now()
  const endpoint = `http://127.0.0.1:${port}/json/version`
  let lastError = null

  while (Date.now() - start < timeoutMs) {
    try {
      const payload = await new Promise((resolve, reject) => {
        const req = http.get(endpoint, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            body += chunk
          })
          response.on('end', () => {
            if (response.statusCode !== 200) {
              reject(new Error(`HTTP ${response.statusCode}`))
              return
            }
            try {
              resolve(JSON.parse(body))
            } catch (error) {
              reject(error)
            }
          })
        })
        req.on('error', reject)
        req.setTimeout(2000, () => {
          req.destroy(new Error('timeout'))
        })
      })
      if (payload && payload.webSocketDebuggerUrl) {
        return payload
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  const suffix = lastError ? ` Last error: ${lastError.message}` : ''
  throw new Error(`CDP endpoint not ready within ${timeoutMs}ms.${suffix}`)
}

test('E2E smoke: launchApp 可以真实拉起 Electron 并连接 CDP', { skip: !shouldRunSmoke }, async () => {
  let app = null

  try {
    app = await launchApp({
      startPort: 9222,
      startupWaitTime: 3000,
    })

    const cdp = await waitForCdpReady(app.port)
    assert.ok(cdp.webSocketDebuggerUrl)
    // Electron 的 CDP /json/version 在不同版本下 Browser 字段可能是 Chrome/*。
    // 因此这里接受两种特征之一：
    // 1) Browser 为 Chrome/*（Chromium 内核）
    // 2) User-Agent 含 Electron（部分版本会暴露）
    const browser = String(cdp.Browser || '')
    const userAgent = String(cdp['User-Agent'] || '')
    const isElectronCdp = /chrome/i.test(browser) || /electron/i.test(userAgent)
    assert.ok(isElectronCdp, `Unexpected CDP identity. Browser=${browser}; User-Agent=${userAgent}`)
  } finally {
    if (app) {
      await app.close()
    }
  }
})
