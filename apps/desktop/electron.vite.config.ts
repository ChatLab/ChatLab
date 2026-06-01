import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

const rootDir = resolve(__dirname, '../..')
const rootPkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'))
const appVersion: string = rootPkg.version

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@openchatlab': resolve(rootDir, 'packages'),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      'process.env.APTABASE_APP_KEY': JSON.stringify(process.env.APTABASE_APP_KEY || ''),
      // ws 的原生加速依赖是可选项；主进程打包时禁用它们，避免 Vite 将缺失的可选依赖改写为启动即抛错。
      'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('true'),
      'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('true'),
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main/index.ts'),
          'worker/dbWorker': resolve(__dirname, 'main/worker/dbWorker.ts'),
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@openchatlab': resolve(rootDir, 'packages'),
      },
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(rootDir, 'src/'),
        '~': resolve(rootDir, 'src/'),
        '@openchatlab': resolve(rootDir, 'packages'),
        '@electron': resolve(__dirname),
      },
    },
    define: {
      __IS_ELECTRON__: JSON.stringify(true),
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
    ],
    root: resolve(rootDir, 'src/'),
    build: {
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/index.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/echarts-wordcloud')) {
              return 'vendor-echarts-wordcloud'
            }
            if (id.includes('node_modules/zrender')) {
              return 'vendor-zrender'
            }
            if (id.includes('node_modules/echarts')) {
              return 'vendor-echarts'
            }
            if (id.includes('node_modules/@nuxt/ui')) {
              return 'vendor-nuxt-ui'
            }
            if (id.includes('node_modules/reka-ui')) {
              return 'vendor-reka-ui'
            }
            if (id.includes('node_modules/@zumer/snapdom')) {
              return 'vendor-snapdom'
            }
            return undefined
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 13100,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 13100,
      },
    },
  },
})
