/**
 * Web 版 Vite 构建配置
 *
 * 用于构建 CLI Web 的 SPA 前端（不含 Electron 依赖）。
 * 输出到 dist-web/，由 chatlab start 托管。
 *
 * 与 Electron renderer 构建的关键区别：
 * - __IS_ELECTRON__ = false（使用 FetchAdapter 而非 window.chatApi）
 * - 不包含 apps/desktop/preload 和 apps/desktop/main
 * - 输出目录独立（dist-web/ vs out/renderer/）
 */

import { resolve } from 'path'
import { readFileSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import * as net from 'net'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { DEFAULT_API_PORT } from './packages/config/src/schema'
import { createChatlabStartCommand, terminateChatlabStartProcess } from './scripts/dev-server-command.mjs'
import { chatlabIconBundle } from './vite.icon-bundle.config'

const BACKEND_PORT = DEFAULT_API_PORT

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(true)
        return
      }
      reject(error)
    })
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

async function isChatlabBackendResponsive(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/_web/sessions`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.status === 200 || response.status === 401 || response.status === 403
  } catch {
    return false
  }
}

/**
 * 自动启动 chatlab start 后端的插件
 * 仅在 CHATLAB_AUTO_SERVE=1 时生效（由 dev:web 脚本设置）
 */
function chatlabServePlugin(): Plugin {
  let serverProcess: ChildProcess | null = null
  let processCleanupRegistered = false

  function unregisterProcessCleanup() {
    if (!processCleanupRegistered) return
    process.off('exit', stopServerProcess)
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    processCleanupRegistered = false
  }

  function stopServerProcess() {
    if (!serverProcess) return
    terminateChatlabStartProcess(serverProcess)
    serverProcess = null
    unregisterProcessCleanup()
  }

  function handleSigint() {
    stopServerProcess()
    process.exit(130)
  }

  function handleSigterm() {
    stopServerProcess()
    process.exit(143)
  }

  function registerProcessCleanup() {
    if (processCleanupRegistered) return
    process.once('exit', stopServerProcess)
    process.once('SIGINT', handleSigint)
    process.once('SIGTERM', handleSigterm)
    processCleanupRegistered = true
  }

  return {
    name: 'chatlab-start',
    async configureServer(server) {
      if (process.env.CHATLAB_AUTO_SERVE !== '1') return

      const inUse = await isPortInUse(BACKEND_PORT)
      if (inUse) {
        const responsive = await isChatlabBackendResponsive(BACKEND_PORT)
        if (responsive) {
          console.log(`[chatlab start] Port ${BACKEND_PORT} already has a responsive ChatLab API, skipping`)
          return
        }
        throw new Error(
          `[chatlab start] Port ${BACKEND_PORT} is in use, but ChatLab API did not respond. Stop the stale process and restart dev:web.`
        )
      }

      const serverDir = resolve(__dirname, 'apps/cli')
      const startCommand = createChatlabStartCommand({
        serverDir,
        backendPort: BACKEND_PORT,
      })
      serverProcess = spawn(startCommand.command, startCommand.args, startCommand.options)

      serverProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) console.log(`[chatlab start] ${line}`)
      })
      serverProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) console.error(`[chatlab start] ${line}`)
      })
      serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(`[chatlab start] exited with code ${code}`)
        }
        serverProcess = null
        unregisterProcessCleanup()
      })
      registerProcessCleanup()
      server.httpServer?.once('close', stopServerProcess)
    },
    buildEnd() {
      stopServerProcess()
    },
  }
}

export default defineConfig({
  root: 'src/',
  base: '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/'),
      '~': resolve(__dirname, 'src/'),
      '@openchatlab': resolve(__dirname, 'packages'),
      '@electron/shared': resolve(__dirname, 'apps/desktop/shared'),
      '@electron/preload': resolve(__dirname, 'apps/desktop/preload'),
    },
  },
  define: {
    __IS_ELECTRON__: JSON.stringify(false),
    __IS_BROWSER_STANDALONE__: JSON.stringify(false),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version),
  },
  plugins: [
    vue(),
    ui({
      ui: {
        colors: {
          primary: 'pink',
          neutral: 'zinc',
        },
      },
    }),
    chatlabIconBundle(__dirname),
    chatlabServePlugin(),
  ],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts-wordcloud')) return 'vendor-echarts-wordcloud'
          if (id.includes('node_modules/zrender')) return 'vendor-zrender'
          if (id.includes('node_modules/echarts')) return 'vendor-echarts'
          if (id.includes('node_modules/@zumer/snapdom')) return 'vendor-snapdom'
          return undefined
        },
      },
    },
  },
  server: {
    port: 3100,
    proxy: {
      '/_web': `http://localhost:${BACKEND_PORT}`,
      '/api': `http://localhost:${BACKEND_PORT}`,
      '/_proxy/chatlab.fun': {
        target: 'https://chatlab.fun',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/_proxy\/chatlab\.fun/, ''),
      },
    },
  },
})
