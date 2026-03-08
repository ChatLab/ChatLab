import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import { createApp } from './index'
import type { AddressInfo } from 'node:net'

/**
 * Integration tests for US-020: End-to-end web application.
 *
 * Verifies health check, session listing, API endpoints,
 * static file serving (production mode), and full web app readiness.
 */

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as AddressInfo
    const reqHeaders: Record<string, string> = { ...headers }
    let bodyStr: string | undefined
    if (body !== undefined) {
      bodyStr = JSON.stringify(body)
      reqHeaders['Content-Type'] = 'application/json'
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString()
    }
    const req = http.request(
      {
        hostname: 'localhost',
        port: addr.port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode!, body: data, headers: res.headers }),
        )
      },
    )
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

describe('Integration: Web Application End-to-End', () => {
  let server: http.Server

  before(() => {
    return new Promise<void>((resolve) => {
      const app = createApp()
      server = app.listen(0, () => resolve())
    })
  })

  after(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  describe('Health Check', () => {
    it('GET /api/health returns { status: "ok" }', async () => {
      const res = await request(server, 'GET', '/api/health')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.strictEqual(data.status, 'ok')
    })

    it('responds with JSON content type', async () => {
      const res = await request(server, 'GET', '/api/health')
      assert.ok(
        res.headers['content-type']?.includes('application/json'),
        'Expected JSON content type',
      )
    })
  })

  describe('Session List', () => {
    it('GET /api/sessions returns an array', async () => {
      const res = await request(server, 'GET', '/api/sessions')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.ok(Array.isArray(data), 'Expected sessions to be an array')
    })
  })

  describe('Import Flow', () => {
    it('POST /api/import/detect-format requires a file upload', async () => {
      const res = await request(server, 'POST', '/api/import/detect-format')
      assert.ok(res.status >= 400, `Expected error status without file, got ${res.status}`)
    })
  })

  describe('LLM Config', () => {
    it('GET /api/llm/configs returns configs object', async () => {
      const res = await request(server, 'GET', '/api/llm/configs')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.ok(data && typeof data === 'object', 'Expected configs object')
      assert.ok(Array.isArray(data.configs), 'Expected configs array')
    })

    it('GET /api/llm/has-config returns boolean', async () => {
      const res = await request(server, 'GET', '/api/llm/has-config')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.ok(typeof data.hasConfig === 'boolean', 'Expected hasConfig boolean')
    })
  })

  describe('Cache Info', () => {
    it('GET /api/cache/info returns cache information', async () => {
      const res = await request(server, 'GET', '/api/cache/info')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.ok(data && typeof data === 'object', 'Expected cache info object')
    })

    it('GET /api/cache/data-dir returns a directory path', async () => {
      const res = await request(server, 'GET', '/api/cache/data-dir')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.ok(typeof data.path === 'string', 'Expected path to be a string')
    })
  })

  describe('Migration', () => {
    it('GET /api/migration/check returns migration status', async () => {
      const res = await request(server, 'GET', '/api/migration/check')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.ok(typeof data.needsMigration === 'boolean', 'Expected needsMigration boolean')
    })
  })

  describe('Embedding Config', () => {
    it('GET /api/embedding/configs returns configs', async () => {
      const res = await request(server, 'GET', '/api/embedding/configs')
      assert.strictEqual(res.status, 200)
    })
  })

  describe('NLP', () => {
    it('GET /api/nlp/pos-tags returns POS tag list', async () => {
      const res = await request(server, 'GET', '/api/nlp/pos-tags')
      assert.strictEqual(res.status, 200)
    })
  })

  describe('Static File Serving (Production)', () => {
    it('serves dist/client/index.html at root if built', async () => {
      const res = await request(server, 'GET', '/')
      if (res.status === 200) {
        assert.ok(
          res.body.includes('<!doctype html>') || res.body.includes('<!DOCTYPE html>'),
          'Expected HTML response',
        )
      } else {
        assert.strictEqual(res.status, 404)
      }
    })

    it('SPA fallback serves index.html for unknown routes', async () => {
      const res = await request(server, 'GET', '/some/vue/route')
      if (res.status === 200) {
        assert.ok(
          res.body.includes('ChatLab') || res.body.includes('<!doctype html>'),
          'Expected SPA fallback to serve index.html',
        )
      } else {
        assert.strictEqual(res.status, 404)
      }
    })

    it('API routes are not caught by SPA fallback', async () => {
      const res = await request(server, 'GET', '/api/health')
      assert.strictEqual(res.status, 200)
      const data = JSON.parse(res.body)
      assert.strictEqual(data.status, 'ok')
    })
  })

  describe('CORS', () => {
    it('includes Access-Control-Allow-Origin header', async () => {
      const res = await request(server, 'GET', '/api/health')
      assert.ok(res.headers['access-control-allow-origin'], 'Expected CORS header')
    })
  })

  describe('Package Scripts', () => {
    it('dev script starts both server and client', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

      assert.ok(pkg.scripts.dev, 'dev script should exist')
      assert.ok(pkg.scripts.dev.includes('concurrently'), 'dev script should use concurrently')
      assert.ok(
        pkg.scripts.dev.includes('tsx') && pkg.scripts.dev.includes('server/index.ts'),
        'dev script should start Express server via tsx',
      )
      assert.ok(pkg.scripts.dev.includes('vite'), 'dev script should start Vite dev server')
    })

    it('start script uses production mode', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

      assert.ok(pkg.scripts.start, 'start script should exist')
      assert.ok(pkg.scripts.start.includes('NODE_ENV=production'), 'start script should set NODE_ENV=production')
      assert.ok(pkg.scripts.start.includes('tsx server/index.ts'), 'start script should run server/index.ts via tsx')
    })

    it('build script typechecks server and builds client', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

      assert.ok(pkg.scripts.build, 'build script should exist')
      assert.ok(pkg.scripts.build.includes('tsc'), 'build script should run TypeScript check')
      assert.ok(pkg.scripts.build.includes('vite build'), 'build script should run vite build')
    })

    it('no electron dependencies in package.json', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const electronPkgs = Object.keys(allDeps).filter(
        (k) => k === 'electron' || k.startsWith('@electron') || k.startsWith('electron-'),
      )
      assert.deepStrictEqual(electronPkgs, [], `Found electron packages: ${electronPkgs.join(', ')}`)
    })
  })

  describe('Vite Config', () => {
    it('configures /api proxy to Express', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const viteConfigPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../vite.config.ts')
      const content = fs.readFileSync(viteConfigPath, 'utf8')

      assert.ok(content.includes("'/api'"), 'Vite config should proxy /api')
      assert.ok(content.includes('localhost:3001'), 'Vite config should proxy to Express on port 3001')
    })

    it('builds to dist/client directory', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const viteConfigPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../vite.config.ts')
      const content = fs.readFileSync(viteConfigPath, 'utf8')

      assert.ok(content.includes('dist/client'), 'Vite should build to dist/client')
    })
  })

  describe('No Electron References', () => {
    it('no electron/ directory exists', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const electronDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../electron')
      assert.ok(!fs.existsSync(electronDir), 'electron/ directory should not exist')
    })

    it('README.md documents web app setup, not Electron', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const readmePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../README.md')
      const content = fs.readFileSync(readmePath, 'utf8')

      // Should describe web app, not Electron
      assert.ok(
        content.includes('pnpm dev') || content.includes('npm run dev'),
        'README should mention dev command',
      )
      assert.ok(
        !content.includes('electron-fix'),
        'README should not reference electron-fix',
      )
    })
  })

  describe('Chart Packages', () => {
    it('all chart packages exist and contain Vue components', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const packagesDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../packages')
      const chartDirs = ['chart-cluster', 'chart-interaction', 'chart-message', 'chart-ranking']

      for (const dir of chartDirs) {
        const dirPath = path.join(packagesDir, dir)
        assert.ok(fs.existsSync(dirPath), `packages/${dir} should exist`)

        const files = fs.readdirSync(dirPath)
        const vueFiles = files.filter((f: string) => f.endsWith('.vue'))
        assert.ok(vueFiles.length > 0, `packages/${dir} should contain at least one Vue component`)
      }
    })

    it('chart packages do not use Electron APIs', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const packagesDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../packages')

      function walkFiles(dir: string): string[] {
        const result: string[] = []
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) result.push(...walkFiles(full))
          else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) result.push(full)
        }
        return result
      }

      const files = walkFiles(packagesDir)
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8')
        assert.ok(!content.includes("from 'electron'"), `${path.relative(packagesDir, file)} should not import electron`)
        assert.ok(!content.includes('window.electron'), `${path.relative(packagesDir, file)} should not use window.electron`)
      }
    })
  })
})
