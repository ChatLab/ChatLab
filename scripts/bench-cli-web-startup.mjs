#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const DEFAULT_URL = 'http://127.0.0.1:3100/'
const DEFAULT_RUNS = 10
const DEFAULT_WARMUPS = 1
const DEFAULT_TIMEOUT_MS = 15_000

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`)
  return parsed
}

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    runs: DEFAULT_RUNS,
    warmups: DEFAULT_WARMUPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    chromePath: process.env.CHATLAB_CHROME_PATH,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    const next = () => {
      const value = argv[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      index += 1
      return value
    }

    if (arg === '--url') options.url = next()
    else if (arg === '--runs') options.runs = parsePositiveInteger(next(), arg)
    else if (arg === '--warmups') options.warmups = parseNonNegativeInteger(next(), arg)
    else if (arg === '--timeout') options.timeoutMs = parsePositiveInteger(next(), arg)
    else if (arg === '--chrome') options.chromePath = next()
    else if (arg === '--json') options.json = true
    else if (arg === '--help') {
      console.log(`Usage: pnpm bench:startup [options]

The CLI Web server must already be running. The benchmark launches an isolated
headless Chrome profile and reads timing-only data from the page.

Options:
  --url <url>         CLI Web URL (default: ${DEFAULT_URL})
  --runs <count>      Recorded reloads (default: ${DEFAULT_RUNS})
  --warmups <count>   Unrecorded warm-up reloads (default: ${DEFAULT_WARMUPS})
  --timeout <ms>      Per-reload startup timeout (default: ${DEFAULT_TIMEOUT_MS})
  --chrome <path>     Chrome/Chromium executable (or CHATLAB_CHROME_PATH)
  --json              Print the full result as JSON
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function resolveChromePath(explicitPath) {
  const candidates = [
    explicitPath,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('Chrome executable not found; pass --chrome or set CHATLAB_CHROME_PATH')
  return found
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to reserve a CDP port'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (payload.id) {
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
        if (payload.error) pending.reject(new Error(payload.error.message))
        else pending.resolve(payload.result)
        return
      }
      if (!payload.method) return
      const listeners = this.listeners.get(payload.method) ?? []
      this.listeners.delete(payload.method)
      for (const listener of listeners) listener(payload.params)
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const listeners = this.listeners.get(method) ?? []
      const timer = setTimeout(() => {
        this.listeners.set(
          method,
          (this.listeners.get(method) ?? []).filter((listener) => listener !== onEvent)
        )
        reject(new Error(`Timed out waiting for CDP event ${method}`))
      }, timeoutMs)
      const onEvent = (params) => {
        clearTimeout(timer)
        resolve(params)
      }
      listeners.push(onEvent)
      this.listeners.set(method, listeners)
    })
  }

  close() {
    this.socket.close()
  }
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('Failed to connect to Chrome DevTools')), { once: true })
  })
  return new CdpClient(socket)
}

async function readStartupSnapshot(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const evaluation = await client.send('Runtime.evaluate', {
      expression: 'window.__CHATLAB_STARTUP_PERFORMANCE__?.snapshot()',
      returnByValue: true,
    })
    const snapshot = evaluation.result?.value
    if (
      snapshot?.phases?.['runtime-ready'] !== undefined &&
      snapshot.phases['splash-hidden'] !== undefined &&
      snapshot.phases['shell-interactive'] !== undefined &&
      snapshot.phases['sessions-settled'] !== undefined
    ) {
      return snapshot
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(
    'Startup timing API did not report runtime-ready, splash-hidden, shell-interactive and sessions-settled before the timeout'
  )
}

async function navigateAndMeasure(client, url, timeoutMs) {
  const loaded = client.waitFor('Page.loadEventFired', timeoutMs)
  await client.send('Page.navigate', { url })
  await loaded
  return readStartupSnapshot(client, timeoutMs)
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index]
}

function summarize(values) {
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const chromePath = resolveChromePath(options.chromePath)
  const profileDir = await mkdtemp(join(tmpdir(), 'chatlab-startup-bench-'))
  const port = await reservePort()
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, options.timeoutMs)
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(options.url)}`, {
      method: 'PUT',
    })
    if (!targetResponse.ok) throw new Error(`Unable to create Chrome target: HTTP ${targetResponse.status}`)
    const target = await targetResponse.json()
    const client = await connectCdp(target.webSocketDebuggerUrl)

    try {
      await client.send('Page.enable')
      await client.send('Runtime.enable')
      const snapshots = []
      for (let index = 0; index < options.warmups + options.runs; index += 1) {
        const snapshot = await navigateAndMeasure(client, options.url, options.timeoutMs)
        if (index >= options.warmups) snapshots.push(snapshot)
      }

      const runtimeValues = snapshots.map((snapshot) => snapshot.phases['runtime-ready'])
      const splashValues = snapshots.map((snapshot) => snapshot.phases['splash-hidden'])
      const shellValues = snapshots.map((snapshot) => snapshot.phases['shell-interactive'])
      const sessionValues = snapshots.map((snapshot) => snapshot.phases['sessions-settled'])
      const result = {
        url: options.url,
        runs: options.runs,
        warmups: options.warmups,
        runtimeReadyMs: summarize(runtimeValues),
        splashHiddenMs: summarize(splashValues),
        shellInteractiveMs: summarize(shellValues),
        sessionsSettledMs: summarize(sessionValues),
        samples: snapshots,
      }

      if (options.json) console.log(JSON.stringify(result, null, 2))
      else {
        console.table({
          'runtime ready': result.runtimeReadyMs,
          'splash hidden': result.splashHiddenMs,
          'shell interactive': result.shellInteractiveMs,
          'sessions settled': result.sessionsSettledMs,
        })
      }
    } finally {
      client.close()
    }
  } finally {
    const chromeExited = new Promise((resolve) => chrome.once('exit', resolve))
    chrome.kill('SIGTERM')
    await Promise.race([chromeExited, new Promise((resolve) => setTimeout(resolve, 2_000))])
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
