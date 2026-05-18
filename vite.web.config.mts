/**
 * Web 版 Vite 构建配置
 *
 * 用于构建 CLI serve Web 的 SPA 前端（不含 Electron 依赖）。
 * 输出到 dist-web/，由 chatlab serve 托管。
 *
 * 与 Electron renderer 构建的关键区别：
 * - __IS_ELECTRON__ = false（使用 FetchAdapter 而非 window.chatApi）
 * - 不包含 electron/preload 和 electron/main
 * - 输出目录独立（dist-web/ vs out/renderer/）
 */

import { resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import * as net from 'net'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

const BACKEND_PORT = 3110

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * 自动启动 chatlab serve 后端的插件
 * 仅在 CHATLAB_AUTO_SERVE=1 时生效（由 dev:web 脚本设置）
 */
function chatlabServePlugin(): Plugin {
  let serverProcess: ChildProcess | null = null

  return {
    name: 'chatlab-serve',
    async configureServer() {
      if (process.env.CHATLAB_AUTO_SERVE !== '1') return

      const inUse = await isPortInUse(BACKEND_PORT)
      if (inUse) {
        console.log(`[chatlab serve] 端口 ${BACKEND_PORT} 已在使用中，跳过启动`)
        return
      }

      const serverDir = resolve(__dirname, 'packages/server')
      const coreDir = resolve(__dirname, 'packages/core/src')
      const runtimeDir = resolve(__dirname, 'packages/node-runtime/src')
      serverProcess = spawn(
        'npx',
        [
          'tsx',
          'watch',
          '--include',
          `${coreDir}/**`,
          '--include',
          `${runtimeDir}/**`,
          'src/cli.ts',
          'serve',
          '--port',
          String(BACKEND_PORT),
        ],
        {
          cwd: serverDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        }
      )

      serverProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) console.log(`[chatlab serve] ${line}`)
      })
      serverProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) console.error(`[chatlab serve] ${line}`)
      })
      serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(`[chatlab serve] exited with code ${code}`)
        }
        serverProcess = null
      })
    },
    buildEnd() {
      if (serverProcess) {
        serverProcess.kill()
        serverProcess = null
      }
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
      '@electron/shared': resolve(__dirname, 'electron/shared'),
      '@electron/preload': resolve(__dirname, 'electron/preload'),
    },
  },
  define: {
    __IS_ELECTRON__: JSON.stringify(false),
    __IS_BROWSER_STANDALONE__: JSON.stringify(false),
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
          if (id.includes('node_modules/@nuxt/ui')) return 'vendor-nuxt-ui'
          if (id.includes('node_modules/reka-ui')) return 'vendor-reka-ui'
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
