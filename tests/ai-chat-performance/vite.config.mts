import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { chatlabIconBundle } from '../../vite.icon-bundle.config'

const repositoryRoot = resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@': resolve(repositoryRoot, 'src'),
      '~': resolve(repositoryRoot, 'src'),
      '@openchatlab': resolve(repositoryRoot, 'packages'),
      '@electron/shared': resolve(repositoryRoot, 'apps/desktop/shared'),
      '@electron/preload': resolve(repositoryRoot, 'apps/desktop/preload'),
    },
  },
  define: {
    __IS_ELECTRON__: JSON.stringify(false),
    __IS_WEB_WASM__: JSON.stringify(false),
    __APP_VERSION__: JSON.stringify('benchmark'),
  },
  plugins: [vue(), ui({ dts: false }), chatlabIconBundle(repositoryRoot)],
  server: {
    host: '127.0.0.1',
    port: 3190,
  },
})
