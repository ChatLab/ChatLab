import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  root,
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.join(projectRoot, 'src'),
      '@openchatlab/core': path.join(projectRoot, 'packages/core/src'),
    },
  },
  build: {
    outDir: path.join(projectRoot, 'tmp/chart-smoke-build'),
    emptyOutDir: true,
  },
})
