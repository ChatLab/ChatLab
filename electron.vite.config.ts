import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

export default defineConfig(() => {
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        // 使用系统环境变量
        'process.env.APTABASE_APP_KEY': JSON.stringify(process.env.APTABASE_APP_KEY || ''),
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'electron/main/index.ts'),
            'worker/dbWorker': resolve(__dirname, 'electron/main/worker/dbWorker.ts'),
          },
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'electron/preload/index.ts'),
          },
        },
      },
    },
    renderer: {
      resolve: {
        alias: {
          '@': resolve('src/'),
          '~': resolve('src/'),
          '@openchatlab': resolve('packages'),
        },
      },
      plugins: [
        vue(),
        ui({
          ui: {
            colors: {
              primary: 'pink', // 使用自定义 pink 作为主色
              neutral: 'zinc',
            },
          },
        }),
      ],
      root: 'src/',
      build: {
        sourcemap: false,
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/index.html'),
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
        port: 3400,
        hmr: {
          protocol: 'ws',
          host: 'localhost',
          port: 3400,
        },
      },
    },
  }
})
