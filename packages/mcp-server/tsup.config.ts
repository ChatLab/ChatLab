import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  noExternal: [/^@openchatlab\//],
})
