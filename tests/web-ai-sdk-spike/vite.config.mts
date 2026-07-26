import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  build: {
    target: 'esnext',
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        baseline: path.join(root, 'baseline.html'),
        spike: path.join(root, 'index.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3131,
    strictPort: true,
  },
})
