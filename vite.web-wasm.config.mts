import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vite'
import { chatlabIconBundle } from './vite.icon-bundle.config'

const rootDir = import.meta.dirname

export default defineConfig({
  root: resolve(rootDir, 'apps/web-wasm'),
  base: '/',
  plugins: [
    vue(),
    ui({
      dts: false,
      ui: {
        colors: {
          primary: 'pink',
          neutral: 'zinc',
        },
      },
    }),
    chatlabIconBundle(rootDir),
  ],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
      '~': resolve(rootDir, 'src'),
      '@openchatlab': resolve(rootDir, 'packages'),
      '@electron/shared': resolve(rootDir, 'apps/desktop/shared'),
      '@electron/preload': resolve(rootDir, 'apps/desktop/preload'),
    },
  },
  define: {
    __IS_ELECTRON__: JSON.stringify(false),
    __IS_WEB_WASM__: JSON.stringify(true),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')).version),
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: resolve(rootDir, 'dist-web-wasm'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 3130,
    open: true,
  },
})
